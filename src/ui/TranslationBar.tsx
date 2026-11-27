/**
 * Shown at the top of a translated chat while something stands in the way:
 * the browser still has to download a language model (which it does only
 * after a click), a download is running, or messages could not be translated.
 */
import { DETECTOR, languageName } from '../core/translate/onDeviceTranslation';
import { TranslateIcon } from './icons';
import type { ChatTranslation } from './useChatTranslation';

export function TranslationBar({ translation, target }: { translation: ChatTranslation; target: string }) {
  const { missing, failed, progress, downloadError } = translation;
  let text: string;
  let action: string | null = null;
  if (progress !== null) {
    text = `Downloading languages for translation… ${Math.round(progress * 100)}%`;
  } else if (missing.length) {
    const pairs = missing.filter((f) => f !== DETECTOR).map((f) => `${languageName(f)} → ${languageName(target)}`);
    text = pairs.length
      ? `To translate, the browser needs ${pairs.join(', ')} once. It is downloaded to this device, and messages never leave it.`
      : 'To translate, the browser needs its language detector once. It is downloaded to this device, and messages never leave it.';
    action = 'Download';
  } else if (downloadError) {
    text = `The download didn’t finish: ${downloadError}`;
    action = 'Try again';
  } else if (failed) {
    text = failed === 1 ? 'A message couldn’t be translated.' : `${failed} messages couldn’t be translated.`;
    action = 'Try again';
  } else {
    return null;
  }
  return (
    <div className="translate-bar" role="status">
      <TranslateIcon aria-hidden="true" />
      <span>{text}</span>
      {action && (
        <button type="button" className="translate-bar-btn" onClick={() => void translation.download()}>
          {action}
        </button>
      )}
    </div>
  );
}
