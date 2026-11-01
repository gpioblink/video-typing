export interface DemoDeviceInfo {
  userAgent: string;
  platform?: string;
  maxTouchPoints: number;
  mobileHint?: boolean;
  coarsePointer?: boolean;
  screenWidth?: number;
  screenHeight?: number;
}

/** Classify the visitor's device, not the size of a resized desktop window.
 * iPadOS can present a Mac user agent, so account for its touch capability. */
export function getDemoDeviceKind(info: DemoDeviceInfo): 'phone' | 'tablet' | 'desktop' {
  // Explicit tablet identities take precedence over a generic mobile hint.
  if (/iPad|Tablet|Silk/i.test(info.userAgent)
    || (/Android/i.test(info.userAgent) && !/Mobile/i.test(info.userAgent))
    || (info.platform === 'MacIntel' && info.maxTouchPoints > 1)) return 'tablet';
  if (info.mobileHint || /iPhone|iPod|Windows Phone|Android.*Mobile/i.test(info.userAgent)) return 'phone';
  if (info.coarsePointer && info.maxTouchPoints > 0) {
    const shortSide = Math.min(info.screenWidth || Infinity, info.screenHeight || Infinity);
    return shortSide < 768 ? 'phone' : 'tablet';
  }
  return 'desktop';
}
