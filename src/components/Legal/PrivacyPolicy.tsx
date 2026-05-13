import styles from './PrivacyPolicy.module.css'

interface Props {
  onClose: () => void
}

export default function PrivacyPolicy({ onClose }: Props) {
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Privacy Policy">
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2 className={styles.title}>Privacy Policy</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close privacy policy">✕</button>
        </div>
        <div className={styles.content}>
          <p className={styles.lastUpdated}>Last updated: May 2025</p>

          <h3>Overview</h3>
          <p>
            BluePrint3D ("the App") converts architectural drawing files into interactive 3D models.
            Your privacy matters to us. This policy explains what data the App collects and how it is used.
          </p>

          <h3>Data We Collect</h3>
          <p>
            <strong>Drawing files:</strong> PDF and image files you upload are processed entirely on-device.
            They are never transmitted to any external server.
          </p>
          <p>
            <strong>Project data:</strong> Projects you save are stored locally on your device using
            IndexedDB. No account or sign-in is required, and no project data leaves your device.
          </p>
          <p>
            <strong>Usage analytics:</strong> The App does not collect analytics, crash reports, or
            any personally identifiable information.
          </p>

          <h3>Third-Party Services</h3>
          <p>
            The App does not integrate with third-party analytics, advertising, or tracking SDKs.
            No data is shared with third parties.
          </p>

          <h3>Permissions</h3>
          <p>
            <strong>Internet:</strong> Required for the app to load correctly inside its WebView
            container. No outbound network requests to external servers are made during normal use.
          </p>
          <p>
            <strong>Storage (Android 13+):</strong> Read access to media files is requested only when
            you choose to import images from your device.
          </p>

          <h3>Children's Privacy</h3>
          <p>
            The App is not directed at children under 13 and does not knowingly collect data from children.
          </p>

          <h3>Changes to This Policy</h3>
          <p>
            We may update this policy from time to time. Changes will be reflected in the "Last updated"
            date above and in the Play Store listing.
          </p>

          <h3>Contact</h3>
          <p>
            Questions? Contact us at{' '}
            <a href="mailto:privacy@blueprint3d.app" className={styles.link}>
              privacy@blueprint3d.app
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
