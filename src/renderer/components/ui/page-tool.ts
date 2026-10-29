import { createContext, useContext } from 'react'
import type { LucideIcon } from 'lucide-react'

/** The current page's tool colour id, sidebar label and icon (set by Layout). */
export interface PageTool {
  tool: string; label: string; icon: LucideIcon | null
  /** Make pages: opens this page's guide in Guides ("How it works" in the header). */
  openGuide?: () => void
}

export const PageToolContext = createContext<PageTool | null>(null)

/** For page headers: the tool chip above the title. Null outside the app frame. */
export function usePageTool(): PageTool | null {
  return useContext(PageToolContext)
}
