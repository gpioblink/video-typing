const TOAST_ID = 'video-typing-toast';

export function showToast(message: string) {
  document.getElementById(TOAST_ID)?.remove();

  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    padding: '10px 14px',
    borderRadius: '10px',
    background: 'rgba(30, 36, 45, 0.95)',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'system-ui, sans-serif',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
  });

  document.body.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3000);
}
