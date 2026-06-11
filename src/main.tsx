import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { extend } from '@react-three/fiber'
import * as THREE from 'three'
import './index.css'
import './styles/mobile.css'
import App from './App.tsx'

// R3F v9 requires explicit registration of Three.js classes for JSX usage.
// This registers the entire THREE namespace so elements like <mesh>,
// <boxGeometry>, <meshStandardMaterial>, etc. are recognised by the reconciler.
extend(THREE as any) // eslint-disable-line @typescript-eslint/no-explicit-any

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
