import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory, openProject } from "@/commands/fs"
import { getLastProject, saveLastProject, loadLlmConfig } from "@/lib/project-store"
import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const lastProject = await getLastProject()
        if (lastProject) {
          try {
            const proj = await openProject(lastProject.path)
            await handleProjectOpened(proj)
          } catch {
            // Last project no longer valid
          }
        }
      } catch {
        // ignore init errors
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    setProject(proj)
    setSelectedFile(null)
    setActiveView("wiki")
    await saveLastProject(proj)
    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleOpenProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Wiki Project",
    })
    if (!selected) return
    try {
      const proj = await openProject(selected)
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  function handleSwitchProject() {
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-muted-foreground">
        Loading...
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
    </>
  )
}

export default App
