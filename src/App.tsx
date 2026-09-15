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
      {/*
        The workspace mounts underneath from the start, so the heavy 3D scene is
        warming up while the user is still reading the front door.

        But mounted must not mean LIVE. Behind the gate it was a fully
        interactive app: 167 controls in the tab order, the onboarding card's
        preset chips sitting directly behind the Launch button, and a Tab press
        on the front door walking straight into a workspace nobody had opened
        yet. `inert` keeps the warm-up and takes away the input — the subtree
        renders and initialises, and is untabbable, unclickable and hidden from
        assistive tech until the gate lifts.
      */}
      <div inert={!launched} style={{ display: 'contents' }}>
        <WorkspaceLayout />
      </div>
      {!launched && <LaunchScreen onLaunch={() => setLaunched(true)} />}
    </>
  )
}

export default App
