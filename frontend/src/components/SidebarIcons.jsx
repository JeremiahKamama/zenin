/**
 * SidebarIcons.jsx
 * 
 * Brand System v2 - Pure monochrome sidebar icons using lucide-react
 * Replaces generic SVG icons with lucide-react for consistency and bundle optimization
 */

import {
  Home,
  PieChart,
  Eye,
  BarChart3,
  Search,
  Activity,
  Settings as OptionsIconLucide,
  Settings2 as Settings2Icon,
  Target,
  NotebookText,
  LayoutDashboard,
  GitCommitHorizontal,
  Receipt,
  Zap,
  Moon,
  Sun,
  User,
  Bell,
  LogOut,
  Star,
  TrendingUp,
  BookOpen,
  FileText,
  Radar
} from "lucide-react";

// Common props for all icons to maintain consistency
const iconProps = {
  size: 18,
  strokeWidth: 2,
  "aria-hidden": "true"
};

export function HomeIcon() {
  return <Home {...iconProps} />;
}

export function PortfolioIcon() {
  return <PieChart {...iconProps} />;
}

export function WatchlistIcon() {
  return <Eye {...iconProps} />;
}

export function AnalyticsIcon() {
  return <BarChart3 {...iconProps} />;
}

export function ResearchIcon() {
  return <BookOpen {...iconProps} />;
}

export function MetricsIcon() {
  return <Activity {...iconProps} />;
}

export function OptionsIcon() {
  return <OptionsIconLucide {...iconProps} />;}

export function SettingsIcon() {
  return <Settings2Icon {...iconProps} />;
}

export function PredictionsIcon() {
  return <Target {...iconProps} />;
}

export function JournalIcon() {
  return <NotebookText {...iconProps} />;
}

export function BriefingIcon() {
  return <LayoutDashboard {...iconProps} />;
}

export function DecisionsIcon() {
  return <GitCommitHorizontal {...iconProps} />;
}

export function IntelligenceIcon() {
  return <Radar {...iconProps} />;
}

export function TaxIcon() {
  return <Receipt {...iconProps} />;
}

export function LiveRailIcon() {
  return <Zap {...iconProps} />;
}

export function ThemeDarkIcon() {
  return <Moon {...iconProps} />;
}

export function ThemeLightIcon() {
  return <Sun {...iconProps} />;
}

export function AccountIcon() {
  return <User {...iconProps} />;
}

export function NotificationIcon() {
  return <Bell {...iconProps} />;
}

export function LogoutIcon() {
  return <LogOut {...iconProps} />;
}

// Additional icons that might be used elsewhere
export function StarIcon() {
  return <Star {...iconProps} />;
}

export function TrendingUpIcon() {
  return <TrendingUp {...iconProps} />;
}

export function FileTextIcon() {
  return <FileText {...iconProps} />;
}

export default {
  HomeIcon,
  PortfolioIcon,
  WatchlistIcon,
  AnalyticsIcon,
  ResearchIcon,
  MetricsIcon,
  OptionsIcon,
  PredictionsIcon,
  JournalIcon,
  BriefingIcon,
  DecisionsIcon,
  TaxIcon,
  LiveRailIcon,
  ThemeDarkIcon,
  ThemeLightIcon,
  AccountIcon,
  NotificationIcon,
  LogoutIcon,
  StarIcon,
  TrendingUpIcon,
  FileTextIcon,
  IntelligenceIcon,
  SettingsIcon
};
