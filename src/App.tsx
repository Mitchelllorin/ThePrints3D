import AppShell from './components/Layout/AppShell'
import ModelViewer from './components/Viewer3D/ModelViewer'
import CSSVarInjector from './components/Settings/CSSVarInjector'

function App() {
  return (
    <>
      <CSSVarInjector />
      <AppShell>
        <ModelViewer />
      </AppShell>
    </>
  )
}

export default App
