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
          <p className={styles.lastUpdated}>Last updated: July 2026</p>

          <h3>Overview</h3>
          <p>
            ThePrints3D ("the App") converts architectural drawing files into interactive 3D models.
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

          <h3>Product Placement and Affiliate Links</h3>
          <p>
            The App includes a catalog of building products &mdash; doors, windows, plumbing fixtures,
            HVAC equipment, kitchen and bath fittings, flooring and lighting &mdash; that you can place
            into your model. Browsing and placing products happens entirely on your device.
          </p>
          <p>
            Some catalog entries link out to a manufacturer's or retailer's own web page, and some of
            those are affiliate links, meaning we may earn a commission if you buy something after
            following one. If you tap through, that destination site is outside the App and governed by
            its own privacy policy; an affiliate link may carry a referral identifier so the referral can
            be attributed. We are not told which products you place, and we receive no personal
            information about you from these links.
          </p>

          <h3>Third-Party Services</h3>
          <p>
            The App does not integrate with third-party analytics, advertising, or tracking SDKs.
            No data is shared with third parties. The only third parties involved are Google Play,
            which distributes the App, and any product website you choose to open from the catalog.
          </p>

          <h3>Permissions</h3>
          <p>
            <strong>Internet:</strong> Required for the App to load correctly inside its WebView
            container, and to open product links when you tap them. It is not used to transmit your
            drawings or projects &mdash; there is no upload endpoint in the App.
          </p>
          <p>
            <strong>Storage (Android 13+):</strong> Read access to image files is requested only when
            you choose to import a drawing from your device. The App reads the file you pick and
            nothing else.
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
            Questions, or a request to access or delete your data? Contact us at{' '}
            <a href="mailto:info@theprints3D.com" className={styles.link}>
              info@theprints3D.com
            </a>
            . We respond within 30 days.
          </p>
          <p>
            The full policy is published at{' '}
            <a href="https://theprints3D.com/privacy" className={styles.link}
               target="_blank" rel="noopener noreferrer">
              theprints3D.com/privacy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}
