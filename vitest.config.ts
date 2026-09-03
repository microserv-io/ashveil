import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Blender and clip sweeps starve the allocation and frame-budget tests when they share CPUs.
    fileParallelism: false,
  },
})
