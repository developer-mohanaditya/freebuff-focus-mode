/**
 * Freebuff Focus Mode - main-world execution hook
 *
 * Runs in freebuff.com's MAIN execution world to protect the prompt composer
 * from false-positive adblock detection.
 */
(() => {
  'use strict';

  if (window.__freebuffFocusMainLoaded) return;
  window.__freebuffFocusMainLoaded = true;

  try {
    // 1. Hook Freebuff detector's internal Map registry for ad samples
    const origMapSet = Map.prototype.set;
    Map.prototype.set = function(key, val) {
      if (val && typeof val.read === 'function') {
        this.__isFbDetector = true;
        const origRead = val.read;
        val.read = function() {
          try {
            const res = origRead.apply(this, arguments);
            if (res === 'hidden' || res === 'unknown') return 'visible';
            return res || 'visible';
          } catch {
            return 'visible';
          }
        };
      }
      return origMapSet.apply(this, arguments);
    };

    const origMapValues = Map.prototype.values;
    Map.prototype.values = function() {
      const iter = origMapValues.call(this);
      if (!this.__isFbDetector) return iter;

      const items = Array.from(iter);
      for (const item of items) {
        if (item && typeof item.read === 'function') {
          const origRead = item.read;
          item.read = function() {
            try {
              const res = origRead.apply(this, arguments);
              if (res === 'hidden' || res === 'unknown') return 'visible';
              return res || 'visible';
            } catch {
              return 'visible';
            }
          };
        }
      }

      // If no samples currently registered, ensure check() always sees a visible sample
      if (items.length === 0) {
        items.push({ read: () => 'visible' });
      }

      return items[Symbol.iterator]();
    };

    // 2. Hook getComputedStyle for ad elements so checkSample() never flags "hidden"
    const isAdTarget = (el) => {
      if (!el || typeof el.closest !== 'function') return false;
      return !!(
        el.closest('.workspace-phone-ad, [data-chat-ad-slot], [data-gravity-ad], [data-gravity-ad-slot], [data-ad], [data-ad-slot], a[rel~="sponsored"], .fb-focus-hidden') ||
        (el.querySelector && el.querySelector('.workspace-phone-ad, [data-chat-ad-slot], [data-gravity-ad], a[rel~="sponsored"], .fb-focus-hidden'))
      );
    };

    const origGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = function(el, pseudo) {
      const style = origGetComputedStyle.call(this, el, pseudo);
      if (isAdTarget(el)) {
        return new Proxy(style, {
          get(target, prop, receiver) {
            if (prop === 'display') {
              const val = Reflect.get(target, prop, receiver);
              return val === 'none' ? 'block' : val;
            }
            if (prop === 'visibility') {
              const val = Reflect.get(target, prop, receiver);
              return (val === 'hidden' || val === 'collapse') ? 'visible' : val;
            }
            if (prop === 'opacity') {
              const val = Reflect.get(target, prop, receiver);
              return val === '0' ? '1' : val;
            }
            if (prop === 'contentVisibility') {
              const val = Reflect.get(target, prop, receiver);
              return (val === 'hidden' || val === 'auto') ? 'visible' : val;
            }
            const res = Reflect.get(target, prop, receiver);
            return typeof res === 'function' ? res.bind(target) : res;
          }
        });
      }
      return style;
    };

    // 3. Hook getBoundingClientRect for ad links so width/height are never 0
    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function() {
      const rect = origGetBoundingClientRect.apply(this, arguments);
      if (isAdTarget(this)) {
        if (rect.width <= 0 || rect.height <= 0) {
          const x = rect.x || 0;
          const y = rect.y || 0;
          return {
            x,
            y,
            top: y,
            left: x,
            right: x + 320,
            bottom: y + 80,
            width: Math.max(rect.width, 320),
            height: Math.max(rect.height, 80),
            toJSON: () => ({})
          };
        }
      }
      return rect;
    };

    // 4. Force check() to re-evaluate immediately
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('focus'));
  } catch {
    // Fail closed
  }
})();
