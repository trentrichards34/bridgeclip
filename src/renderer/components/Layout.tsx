import { useEffect, useMemo, type ReactNode } from 'react'
import { NAV_ITEMS, Sidebar, toolFor, type Page } from './Sidebar'
import { PageToolContext, type PageTool } from './ui/page-tool'
import { TopBar } from './TopBar'

interface LayoutProps {
  children: ReactNode
  currentPage: Page
  onNavigate: (page: Page) => void
}

/**
 * Signal frame: the sidebar, then the top bar over the page scroll area. A
 * soft glow in the page's tool colour sits behind the top of every page. The
 * top bar strip is a window drag handle; everything interactive opts out.
 */
export function Layout({ children, currentPage, onNavigate }: LayoutProps): React.JSX.Element {
  const tool = toolFor(currentPage)
  // Dialogs and menus are portalled to <body>: they take the page's tool colour from the root.
  useEffect(() => {
    const root = document.documentElement
    root.classList.add(`tool-${tool}`)
    return () => root.classList.remove(`tool-${tool}`)
  }, [tool])
  const pageTool = useMemo<PageTool>(() => {
    const item = NAV_ITEMS.find((entry) => entry.id === currentPage)
    return { tool, label: item?.label ?? '', icon: item?.icon ?? null }
  }, [tool, currentPage])
  return (
    <div className="app-backdrop relative flex h-screen w-screen overflow-hidden">
      <Sidebar currentPage={currentPage} onNavigate={onNavigate} />
      <main data-tool={tool} className={`tool-${tool} relative flex min-w-0 flex-1 flex-col`}>
        <div aria-hidden className="page-glow pointer-events-none absolute -left-20 -top-[180px] h-[420px] w-[900px] max-w-full rounded-full" />
        <TopBar onNavigate={onNavigate} />
        <div id="page-scroll" className="no-drag relative min-h-0 flex-1 overflow-y-auto pt-[var(--shell-gap)]">
          <PageToolContext.Provider value={pageTool}>
            {children}
          </PageToolContext.Provider>
        </div>
      </main>
    </div>
  )
}
