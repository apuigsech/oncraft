<script setup lang="ts">
// Skeleton loader for chat history.
// Mimics a conversation with alternating assistant/user message blocks.
</script>

<template>
  <div class="chat-skeleton">
    <!-- Fake assistant message -->
    <div class="skeleton-message assistant">
      <USkeleton class="skeleton-avatar" />
      <div class="skeleton-bubble">
        <USkeleton class="skeleton-line full" />
        <USkeleton class="skeleton-line medium" />
        <USkeleton class="skeleton-line short" />
      </div>
    </div>

    <!-- Fake user message -->
    <div class="skeleton-message user">
      <div class="skeleton-bubble right">
        <USkeleton class="skeleton-line medium" />
      </div>
    </div>

    <!-- Fake assistant message (longer) -->
    <div class="skeleton-message assistant">
      <USkeleton class="skeleton-avatar" />
      <div class="skeleton-bubble">
        <USkeleton class="skeleton-line full" />
        <USkeleton class="skeleton-line full" />
        <USkeleton class="skeleton-line medium" />
        <USkeleton class="skeleton-line short" />
      </div>
    </div>

    <!-- Fake user message -->
    <div class="skeleton-message user">
      <div class="skeleton-bubble right">
        <USkeleton class="skeleton-line short" />
      </div>
    </div>

    <!-- Fake assistant message -->
    <div class="skeleton-message assistant">
      <USkeleton class="skeleton-avatar" />
      <div class="skeleton-bubble">
        <USkeleton class="skeleton-line full" />
        <USkeleton class="skeleton-line medium" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-skeleton {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 12px;
}

.skeleton-message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.skeleton-message.user {
  justify-content: flex-end;
}

.skeleton-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skeleton-bubble {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 75%;
}

.skeleton-bubble.right {
  align-items: flex-end;
}

.skeleton-line {
  height: 12px;
  border-radius: 4px;
}

.skeleton-line.full { width: 240px; }
.skeleton-line.medium { width: 160px; }
.skeleton-line.short { width: 100px; }
</style>
