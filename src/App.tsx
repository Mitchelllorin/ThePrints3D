import AppShell from './components/Layout/AppShell'
import DrawingUploader from './components/Upload/DrawingUploader'
import DrawingManager from './components/Drawings/DrawingManager'
import ModelViewer from './components/Viewer3D/ModelViewer'
import { useAppStore } from './store/useAppStore'

function App() {
  const view = useAppStore((s) => s.view)

  return (
    <AppShell>
      {view === 'upload' && <DrawingUploader />}
      {view === 'drawings' && <DrawingManager />}
      {view === 'model' && <ModelViewer />}
    </AppShell>
  )
}

export default App
