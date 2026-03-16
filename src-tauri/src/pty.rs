use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

/// Unique ID for each PTY instance
type PtyId = String;

/// Holds the writable master end of each PTY
struct PtyInstance {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
}

/// Global registry of PTY instances
pub struct PtyManager {
    instances: Mutex<HashMap<PtyId, PtyInstance>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
        }
    }
}

/// Payload emitted to the frontend for each chunk of PTY output
#[derive(Clone, serde::Serialize)]
pub struct PtyOutput {
    pub id: String,
    pub data: String,
}

/// Payload emitted when the PTY child process exits
#[derive(Clone, serde::Serialize)]
pub struct PtyExit {
    pub id: String,
    pub code: Option<u32>,
}

/// Spawn a new PTY running `cmd` with `args` in `cwd`.
/// Returns a unique ID the frontend uses for subsequent calls.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: tauri::State<'_, PtyManager>,
    id: String,
    cmd: String,
    args: Vec<String>,
    cwd: String,
    cols: u16,
    rows: u16,
    env_vars: Option<HashMap<String, String>>,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let mut cmd_builder = CommandBuilder::new(&cmd);
    cmd_builder.args(&args);
    cmd_builder.cwd(&cwd);

    // Merge any extra environment variables (e.g. TERM)
    if let Some(vars) = env_vars {
        for (k, v) in vars {
            cmd_builder.env(k, v);
        }
    }

    let mut child = pair
        .slave
        .spawn_command(cmd_builder)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // We need a reader from the master for stdout
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

    // Writer for stdin
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

    let pty_id = id.clone();

    // Store the instance
    {
        let mut instances = state.instances.lock().unwrap();
        instances.insert(
            pty_id.clone(),
            PtyInstance {
                writer,
                master: pair.master,
            },
        );
    }

    // Spawn a thread to read PTY output and emit to frontend
    let app_clone = app.clone();
    let read_id = pty_id.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    // PTY output is often UTF-8 but can contain partial sequences;
                    // use lossy conversion to avoid panics
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty-output",
                        PtyOutput {
                            id: read_id.clone(),
                            data: text,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    // Spawn a thread to wait for child exit and emit event
    let app_clone2 = app.clone();
    let exit_id = pty_id.clone();
    let state_ref = Arc::new(state.instances.lock().unwrap().len()); // just to keep state alive
    drop(state_ref);
    thread::spawn(move || {
        let status = child.wait();
        let code = status.ok().map(|s| {
            s.exit_code()
        });
        let _ = app_clone2.emit(
            "pty-exit",
            PtyExit {
                id: exit_id.clone(),
                code,
            },
        );
    });

    Ok(pty_id)
}

/// Write data (user keystrokes) to the PTY's stdin
#[tauri::command]
pub fn pty_write(
    state: tauri::State<'_, PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    let instance = instances
        .get_mut(&id)
        .ok_or_else(|| format!("No PTY with id: {}", id))?;
    instance
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    instance
        .writer
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

/// Resize the PTY
#[tauri::command]
pub fn pty_resize(
    state: tauri::State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let instances = state.instances.lock().unwrap();
    let instance = instances
        .get(&id)
        .ok_or_else(|| format!("No PTY with id: {}", id))?;
    instance
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;
    Ok(())
}

/// Kill the PTY process and clean up
#[tauri::command]
pub fn pty_kill(
    state: tauri::State<'_, PtyManager>,
    id: String,
) -> Result<(), String> {
    let mut instances = state.instances.lock().unwrap();
    // Dropping the instance will close the master, which signals EOF to the child
    instances.remove(&id);
    Ok(())
}
