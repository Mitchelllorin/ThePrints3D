import AppShell from './components/Layout/AppShell'
import DrawingUploader from './components/Upload/DrawingUploader'
import DrawingManager from './components/Drawings/DrawingManager'
import ModelViewer from './components/Viewer3D/ModelViewer'
import ProjectLibrary from './components/Projects/ProjectLibrary'
import Toolbox from './components/Tools/Toolbox'
import { useAppStore } from './store/useAppStore'
import { useState } from 'react'

function App() {
  const view = useAppStore((s) => s.view)
  const [libraryOpen, setLibraryOpen] = useState(false)

  return (
    <>
      <AppShell>
        {view === 'upload' && <DrawingUploader />}
        {view === 'drawings' && <DrawingManager />}
        {view === 'model' && <ModelViewer />}
        {view === 'tools' && <Toolbox />}
      </AppShell>
      <button
        onClick={() => setLibraryOpen(true)}
        title="My saved projects"
        aria-label="Open project library"
        style={{
          position: 'fixed',
          bottom: 'calc(var(--safe-bottom, 0px) + 86px)',
          right: 20,
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: '#1e293b',
          color: '#f1f5f9',
          border: '1px solid #334155',
          cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 99,
          fontSize: 22,
        }}
        data-testid="open-project-library-btn"
      >
        📁
      </button>
      {libraryOpen && <ProjectLibrary onClose={() => setLibraryOpen(false)} />}
    </>
  )
}

export default App
