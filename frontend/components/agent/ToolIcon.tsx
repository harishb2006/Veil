import { FileText, Globe, Inbox, Mail, Send, Terminal, Wrench, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  fetch_page: Globe,
  read_inbox: Inbox,
  read_email: Mail,
  read_file: FileText,
  send_email: Send,
  run_shell: Terminal,
};

export function ToolIcon({ tool, className = "h-4 w-4" }: { tool: string | null | undefined; className?: string }) {
  const Icon = (tool && ICONS[tool]) || Wrench;
  return <Icon className={className} aria-hidden />;
}
