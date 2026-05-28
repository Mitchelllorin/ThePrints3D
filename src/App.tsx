import AppShell from './components/Layout/AppShell'
import DrawingUploader from './components/Upload/DrawingUploader'
import DrawingManager from './components/Drawings/DrawingManager'
import ModelViewer from './components/Viewer3D/ModelViewer'
import ProjectLibrary from './components/Projects/ProjectLibrary'
import PrivacyPolicy from './components/Legal/PrivacyPolicy'
import Toolbox from './components/Tools/Toolbox'
import OnboardingWizard from './onboarding/OnboardingWizard'
import { loadWizardState } from './onboarding/storage'
import { useAppStore } from './store/useAppStore'
import { useState } from 'react'

function App() {
  const view = useAppStore((s) => s.view)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  // The wizard renders ONLY on the upload view and ONLY when not skipped/done.
  // On every other view the existing app UI takes over unchanged.
  const [wizardActive] = useState(() => {
    const w = loadWizardState()
    return !w.skipped && w.step !== 'done'
  })

  const showWizard = wizardActive && view === 'upload'

  return (
    <>
      <AppShell>
        {showWizard
          ? <OnboardingWizard />
          : view === 'upload'   ? <DrawingUploader />
          : view === 'drawings' ? <DrawingManager />
          : view === 'model'    ? <ModelViewer />
          : view === 'tools'    ? <Toolbox />
          : null}
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
      <button
        onClick={() => setPrivacyOpen(true)}
        title="Privacy Policy"
        aria-label="Open privacy policy"
        style={{
          position: 'fixed',
          bottom: 'calc(var(--safe-bottom, 0px) + 86px)',
          left: 20,
          padding: '0 12px',
          height: 32,
          borderRadius: 16,
          background: 'transparent',
          color: '#475569',
          border: '1px solid #1e293b',
          cursor: 'pointer',
          zIndex: 99,
          fontSize: 11,
          letterSpacing: '0.02em',
        }}
      >
        Privacy
      </button>
      {libraryOpen && <ProjectLibrary onClose={() => setLibraryOpen(false)} />}
      {privacyOpen && <PrivacyPolicy onClose={() => setPrivacyOpen(false)} />}
    </>
  )
}

export default App
