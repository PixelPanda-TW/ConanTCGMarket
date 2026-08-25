import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

const WELCOME_NOTICE_STORAGE_KEY = 'conan-tcg-market:welcome-notice:v1';
const RUGIA_URL = 'https://rugiacreation.com/conan/search';

function hasAcknowledgedWelcomeNotice() {
  try {
    return window.localStorage.getItem(WELCOME_NOTICE_STORAGE_KEY) === 'acknowledged';
  } catch {
    return false;
  }
}

function rememberWelcomeNoticeAcknowledgement() {
  try {
    window.localStorage.setItem(WELCOME_NOTICE_STORAGE_KEY, 'acknowledged');
  } catch {
    // The acknowledgement still closes this visit if browser storage is unavailable.
  }
}

export function WelcomeNoticeDialog() {
  const [isOpen, setIsOpen] = useState(() => !hasAcknowledgedWelcomeNotice());
  const dialogRef = useRef<HTMLDivElement>(null);
  const acknowledgeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    acknowledgeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  function keepFocusInsideDialog(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;

    const focusableElements = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    );
    if (!focusableElements?.length) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function acknowledge() {
    rememberWelcomeNoticeAcknowledgement();
    setIsOpen(false);
  }

  return (
    <div className="welcome-notice-backdrop">
      <div
        ref={dialogRef}
        className="welcome-notice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-notice-heading"
        onKeyDown={keepFocusInsideDialog}
      >
        <p className="eyebrow">Welcome notice</p>
        <h2 id="welcome-notice-heading">網站使用與安全提醒</h2>
        <p className="welcome-notice-copy">
          此網站經過路基亞{' '}
          <a href={RUGIA_URL} target="_blank" rel="noreferrer">rugiacreation.com</a>
          {' '}同意授權角色名/ ID，請勿擅自搬運網站，若要使用資料請聯絡 路基亞{' '}
          <a href={RUGIA_URL} target="_blank" rel="noreferrer">rugiacreation.com</a>
          {' '}，賣家請小心惡意棄單，買家請留意詐騙，若有任何問題一律統一使用回報系統反應，開發者真心歡迎您的光臨
        </p>
        <button ref={acknowledgeButtonRef} type="button" onClick={acknowledge}>
          我知道了
        </button>
      </div>
    </div>
  );
}
