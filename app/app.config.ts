export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      neutral: 'slate',
    },
    button: {
      defaultVariants: {
        variant: 'soft',
      },
    },
    modal: {
      slots: {
        overlay: 'bg-black/60',
      },
    },
    toast: {
      slots: {
        close: '',
      },
    },
  },
})
