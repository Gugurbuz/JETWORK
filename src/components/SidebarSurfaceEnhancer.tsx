import { useEffect } from 'react';

export function SidebarSurfaceEnhancer() {
  useEffect(() => {
    const apply = () => {
      const sidebar = document.querySelector<HTMLElement>('aside');
      if (sidebar) sidebar.classList.add('jetwork-sidebar-v2');
      return sidebar;
    };

    let current = apply();
    const observer = new MutationObserver(() => {
      const next = apply();
      if (current && current !== next) current.classList.remove('jetwork-sidebar-v2');
      current = next;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      current?.classList.remove('jetwork-sidebar-v2');
    };
  }, []);

  return null;
}
