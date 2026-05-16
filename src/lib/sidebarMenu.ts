import { MASTERS_TABS } from '@/src/lib/mastersTabs';
import { materialMenuItems, pendingQueueItems, purchaseMastersMenuItems, settingsMenuItems, stockMenuItems, topLevelMenuItems } from '@/src/components/Sidebar';

export type SidebarPermissionItem = { key: string; label: string };

// Single source of truth for menu labels used in the left sidebar.
// Sidebar and "Menu Access" permissions both read from this.
export function getSidebarPermissionItems(): SidebarPermissionItem[] {
  const out: SidebarPermissionItem[] = [];

  const push = (key: string, label: string) => {
    const k = String(key ?? '').trim();
    const l = String(label ?? '').trim();
    if (!k || !l) return;
    out.push({ key: k, label: l });
  };

  // Top-level views (source of truth is Sidebar)
  for (const t of topLevelMenuItems) push(String(t.key), t.label);

  // Masters submenu (dynamic from existing masters tab config)
  for (const t of MASTERS_TABS) {
    push(`masters:${t.key}`, t.label);
  }

  for (const q of pendingQueueItems) push(`pending:${q.key}`, q.label);

  // Stock submenu (NavView keys used by Sidebar)
  for (const s of stockMenuItems) push(`stock:${s.key}`, s.label);

  // Material submenu
  for (const m of materialMenuItems) push(`material:${m.key}`, m.label);
  for (const s of settingsMenuItems) push(`settings:${s.key}`, s.label);

  // Purchase Masters submenu
  for (const p of purchaseMastersMenuItems) push(`purchase:${p.key}`, p.label);

  // Stable sort by label for consistent checkbox ordering.
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
