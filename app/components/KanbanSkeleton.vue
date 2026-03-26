<script setup lang="ts">
// Skeleton loader for the Kanban board area.
// Shows 6 ghost columns with placeholder cards while flow/cards load.
const columns = [3, 2, 4, 1, 2, 0]; // card count per skeleton column
</script>

<template>
  <div class="kanban-skeleton">
    <div v-for="(cardCount, colIdx) in columns" :key="colIdx" class="skeleton-column">
      <div class="skeleton-column-header">
        <USkeleton class="skeleton-title" />
        <USkeleton class="skeleton-badge" />
      </div>
      <div class="skeleton-column-body">
        <div v-for="cardIdx in cardCount" :key="cardIdx" class="skeleton-card">
          <USkeleton class="skeleton-card-title" />
          <USkeleton class="skeleton-card-line" />
          <div class="skeleton-card-footer">
            <USkeleton class="skeleton-card-tag" />
            <USkeleton class="skeleton-card-tag" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-skeleton {
  display: flex;
  gap: 12px;
  padding: 16px;
  height: 100%;
  overflow: hidden;
}

.skeleton-column {
  min-width: 260px;
  max-width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.skeleton-column-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.skeleton-title {
  width: 80px;
  height: 14px;
}

.skeleton-badge {
  width: 20px;
  height: 16px;
  border-radius: 8px;
}

.skeleton-column-body {
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.skeleton-card {
  padding: 10px;
  border-radius: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-card-title {
  width: 70%;
  height: 13px;
}

.skeleton-card-line {
  width: 50%;
  height: 10px;
}

.skeleton-card-footer {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

.skeleton-card-tag {
  width: 40px;
  height: 14px;
  border-radius: 6px;
}
</style>
