export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      neutral: 'slate',
    },
    button: {
      defaultVariant: 'soft',
    },
    modal: {
      overlay: {
        background: 'bg-black/60',
      },
    },
    toast: {
      defaultCloseButton: true,
    },
  },
})
