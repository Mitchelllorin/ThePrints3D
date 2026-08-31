import { useState } from 'react'
import CSSVarInjector from './components/Settings/CSSVarInjector'
import LaunchScreen from './components/Launch/LaunchScreen'
import WorkspaceLayout from './components/Layout/WorkspaceLayout'

function App() {
  // The front door shows on every cold start and is gone for the session once
  // dismissed. Deliberately NOT persisted: this is the brand moment and the
  // only in-app route to the legal links and the sibling apps, so it should not
  // quietly disappear forever after one tap.
  const [launched, setLaunched] = useState(false)

  return (
    <>
      <CSSVarInjector />
      {/* The workspace mounts underneath from the start, so the heavy 3D scene
          is warming up while the user is still reading the front door. */}
      <WorkspaceLayout />
      {!launched && <LaunchScreen onLaunch={() => setLaunched(true)} />}
    </>
  )
}

export default App
