module.exports = {
  version: '3.6',
  title: "1K-Eye",
  description: 'Globe 3D untuk menjelajahi data publik dunia secara langsung.',
  menu: async (kernel, info) => {
    const installed = await kernel.exists(__dirname, '.installed');
    const installing = info.running('install.js');
    const starting = info.running('start.js');
    const updating = info.running('update.js');
    const resetting = info.running('reset.js');

    if (installing || updating || resetting) {
      const href = installing ? 'install.js' : updating ? 'update.js' : 'reset.js';
      const text = installing ? 'Memasang' : updating ? 'Memperbarui' : 'Memulihkan';
      return [{ default: true, icon: 'fa-solid fa-terminal', text, href }];
    }

    if (!installed) {
      return [{ default: true, icon: 'fa-solid fa-download', text: 'Pasang', href: 'install.js' }];
    }

    if (starting) {
      const local = info.local('start.js');
      if (local?.url) {
        return [
          { default: true, icon: 'fa-solid fa-earth-americas', text: 'Buka 1K-Eye', href: local.url },
          { icon: 'fa-solid fa-terminal', text: 'Server', href: 'start.js' },
        ];
      }
      return [{ default: true, icon: 'fa-solid fa-terminal', text: 'Memulai', href: 'start.js' }];
    }

    return [
      { default: true, icon: 'fa-solid fa-power-off', text: 'Jalankan', href: 'start.js' },
      { icon: 'fa-solid fa-arrows-rotate', text: 'Perbarui', href: 'update.js' },
      { icon: 'fa-solid fa-broom', text: 'Perbaiki instalasi', href: 'reset.js' },
    ];
  },
};
