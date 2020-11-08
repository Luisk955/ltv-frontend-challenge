require('fetch-polyfill');

// Element closest Polyfill for IE
if (!Element.prototype.matches) {
  Element.prototype.matches =
    Element.prototype.msMatchesSelector ||
    Element.prototype.webkitMatchesSelector;
}

if (!Element.prototype.closest) {
  Element.prototype.closest = function (s) {
    var el = this;

    do {
      if (el.matches(s)) return el;
      el = el.parentElement || el.parentNode;
    } while (el !== null && el.nodeType === 1);
    return null;
  };
}

// Element append Polyfill for IE
(function (arr) {
  [Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(
    function (item) {
      if (item.hasOwnProperty('append')) {
        return;
      }
      Object.defineProperty(item, 'append', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: function append() {
          var argArr = Array.prototype.slice.call(arguments),
            docFrag = document.createDocumentFragment();

          argArr.forEach(function (argItem) {
            var isNode = argItem instanceof Node;
            docFrag.appendChild(
              isNode ? argItem : document.createTextNode(String(argItem))
            );
          });

          this.appendChild(docFrag);
        },
      });
    }
  );
})([Element.prototype, Document.prototype, DocumentFragment.prototype]);

// IntersectionObserver Polyfill
(function () {
  'use strict';

  // Exit early if we're not running in a browser.
  if (typeof window !== 'object') {
    return;
  }

  // Exit early if all IntersectionObserver and IntersectionObserverEntry
  // features are natively supported.
  if (
    'IntersectionObserver' in window &&
    'IntersectionObserverEntry' in window &&
    'intersectionRatio' in window.IntersectionObserverEntry.prototype
  ) {
    // Minimal polyfill for Edge 15's lack of `isIntersecting`
    // See: https://github.com/w3c/IntersectionObserver/issues/211
    if (!('isIntersecting' in window.IntersectionObserverEntry.prototype)) {
      Object.defineProperty(
        window.IntersectionObserverEntry.prototype,
        'isIntersecting',
        {
          get: function () {
            return this.intersectionRatio > 0;
          },
        }
      );
    }
    return;
  }

  /**
   * A local reference to the document.
   */
  var document = window.document;

  /**
   * An IntersectionObserver registry. This registry exists to hold a strong
   * reference to IntersectionObserver instances currently observing a target
   * element. Without this registry, instances without another reference may be
   * garbage collected.
   */
  var registry = [];

  /**
   * Creates the global IntersectionObserverEntry constructor.
   * https://w3c.github.io/IntersectionObserver/#intersection-observer-entry
   * @param {Object} entry A dictionary of instance properties.
   * @constructor
   */
  function IntersectionObserverEntry(entry) {
    this.time = entry.time;
    this.target = entry.target;
    this.rootBounds = entry.rootBounds;
    this.boundingClientRect = entry.boundingClientRect;
    this.intersectionRect = entry.intersectionRect || getEmptyRect();
    this.isIntersecting = !!entry.intersectionRect;

    // Calculates the intersection ratio.
    var targetRect = this.boundingClientRect;
    var targetArea = targetRect.width * targetRect.height;
    var intersectionRect = this.intersectionRect;
    var intersectionArea = intersectionRect.width * intersectionRect.height;

    // Sets intersection ratio.
    if (targetArea) {
      // Round the intersection ratio to avoid floating point math issues:
      // https://github.com/w3c/IntersectionObserver/issues/324
      this.intersectionRatio = Number(
        (intersectionArea / targetArea).toFixed(4)
      );
    } else {
      // If area is zero and is intersecting, sets to 1, otherwise to 0
      this.intersectionRatio = this.isIntersecting ? 1 : 0;
    }
  }

  /**
   * Creates the global IntersectionObserver constructor.
   * https://w3c.github.io/IntersectionObserver/#intersection-observer-interface
   * @param {Function} callback The function to be invoked after intersection
   *     changes have queued. The function is not invoked if the queue has
   *     been emptied by calling the `takeRecords` method.
   * @param {Object=} opt_options Optional configuration options.
   * @constructor
   */
  function IntersectionObserver(callback, opt_options) {
    var options = opt_options || {};

    if (typeof callback != 'function') {
      throw new Error('callback must be a function');
    }

    if (options.root && options.root.nodeType != 1) {
      throw new Error('root must be an Element');
    }

    // Binds and throttles `this._checkForIntersections`.
    this._checkForIntersections = throttle(
      this._checkForIntersections.bind(this),
      this.THROTTLE_TIMEOUT
    );

    // Private properties.
    this._callback = callback;
    this._observationTargets = [];
    this._queuedEntries = [];
    this._rootMarginValues = this._parseRootMargin(options.rootMargin);

    // Public properties.
    this.thresholds = this._initThresholds(options.threshold);
    this.root = options.root || null;
    this.rootMargin = this._rootMarginValues
      .map(function (margin) {
        return margin.value + margin.unit;
      })
      .join(' ');
  }

  /**
   * The minimum interval within which the document will be checked for
   * intersection changes.
   */
  IntersectionObserver.prototype.THROTTLE_TIMEOUT = 100;

  /**
   * The frequency in which the polyfill polls for intersection changes.
   * this can be updated on a per instance basis and must be set prior to
   * calling `observe` on the first target.
   */
  IntersectionObserver.prototype.POLL_INTERVAL = null;

  /**
   * Use a mutation observer on the root element
   * to detect intersection changes.
   */
  IntersectionObserver.prototype.USE_MUTATION_OBSERVER = true;

  /**
   * Starts observing a target element for intersection changes based on
   * the thresholds values.
   * @param {Element} target The DOM element to observe.
   */
  IntersectionObserver.prototype.observe = function (target) {
    var isTargetAlreadyObserved = this._observationTargets.some(function (
      item
    ) {
      return item.element == target;
    });

    if (isTargetAlreadyObserved) {
      return;
    }

    if (!(target && target.nodeType == 1)) {
      throw new Error('target must be an Element');
    }

    this._registerInstance();
    this._observationTargets.push({ element: target, entry: null });
    this._monitorIntersections();
    this._checkForIntersections();
  };

  /**
   * Stops observing a target element for intersection changes.
   * @param {Element} target The DOM element to observe.
   */
  IntersectionObserver.prototype.unobserve = function (target) {
    this._observationTargets = this._observationTargets.filter(function (item) {
      return item.element != target;
    });
    if (!this._observationTargets.length) {
      this._unmonitorIntersections();
      this._unregisterInstance();
    }
  };

  /**
   * Stops observing all target elements for intersection changes.
   */
  IntersectionObserver.prototype.disconnect = function () {
    this._observationTargets = [];
    this._unmonitorIntersections();
    this._unregisterInstance();
  };

  /**
   * Returns any queue entries that have not yet been reported to the
   * callback and clears the queue. This can be used in conjunction with the
   * callback to obtain the absolute most up-to-date intersection information.
   * @return {Array} The currently queued entries.
   */
  IntersectionObserver.prototype.takeRecords = function () {
    var records = this._queuedEntries.slice();
    this._queuedEntries = [];
    return records;
  };

  /**
   * Accepts the threshold value from the user configuration object and
   * returns a sorted array of unique threshold values. If a value is not
   * between 0 and 1 and error is thrown.
   * @private
   * @param {Array|number=} opt_threshold An optional threshold value or
   *     a list of threshold values, defaulting to [0].
   * @return {Array} A sorted list of unique and valid threshold values.
   */
  IntersectionObserver.prototype._initThresholds = function (opt_threshold) {
    var threshold = opt_threshold || [0];
    if (!Array.isArray(threshold)) threshold = [threshold];

    return threshold.sort().filter(function (t, i, a) {
      if (typeof t != 'number' || isNaN(t) || t < 0 || t > 1) {
        throw new Error(
          'threshold must be a number between 0 and 1 inclusively'
        );
      }
      return t !== a[i - 1];
    });
  };

  /**
   * Accepts the rootMargin value from the user configuration object
   * and returns an array of the four margin values as an object containing
   * the value and unit properties. If any of the values are not properly
   * formatted or use a unit other than px or %, and error is thrown.
   * @private
   * @param {string=} opt_rootMargin An optional rootMargin value,
   *     defaulting to '0px'.
   * @return {Array<Object>} An array of margin objects with the keys
   *     value and unit.
   */
  IntersectionObserver.prototype._parseRootMargin = function (opt_rootMargin) {
    var marginString = opt_rootMargin || '0px';
    var margins = marginString.split(/\s+/).map(function (margin) {
      var parts = /^(-?\d*\.?\d+)(px|%)$/.exec(margin);
      if (!parts) {
        throw new Error('rootMargin must be specified in pixels or percent');
      }
      return { value: parseFloat(parts[1]), unit: parts[2] };
    });

    // Handles shorthand.
    margins[1] = margins[1] || margins[0];
    margins[2] = margins[2] || margins[0];
    margins[3] = margins[3] || margins[1];

    return margins;
  };

  /**
   * Starts polling for intersection changes if the polling is not already
   * happening, and if the page's visibility state is visible.
   * @private
   */
  IntersectionObserver.prototype._monitorIntersections = function () {
    if (!this._monitoringIntersections) {
      this._monitoringIntersections = true;

      // If a poll interval is set, use polling instead of listening to
      // resize and scroll events or DOM mutations.
      if (this.POLL_INTERVAL) {
        this._monitoringInterval = setInterval(
          this._checkForIntersections,
          this.POLL_INTERVAL
        );
      } else {
        addEvent(window, 'resize', this._checkForIntersections, true);
        addEvent(document, 'scroll', this._checkForIntersections, true);

        if (this.USE_MUTATION_OBSERVER && 'MutationObserver' in window) {
          this._domObserver = new MutationObserver(this._checkForIntersections);
          this._domObserver.observe(document, {
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
      }
    }
  };

  /**
   * Stops polling for intersection changes.
   * @private
   */
  IntersectionObserver.prototype._unmonitorIntersections = function () {
    if (this._monitoringIntersections) {
      this._monitoringIntersections = false;

      clearInterval(this._monitoringInterval);
      this._monitoringInterval = null;

      removeEvent(window, 'resize', this._checkForIntersections, true);
      removeEvent(document, 'scroll', this._checkForIntersections, true);

      if (this._domObserver) {
        this._domObserver.disconnect();
        this._domObserver = null;
      }
    }
  };

  /**
   * Scans each observation target for intersection changes and adds them
   * to the internal entries queue. If new entries are found, it
   * schedules the callback to be invoked.
   * @private
   */
  IntersectionObserver.prototype._checkForIntersections = function () {
    var rootIsInDom = this._rootIsInDom();
    var rootRect = rootIsInDom ? this._getRootRect() : getEmptyRect();

    this._observationTargets.forEach(function (item) {
      var target = item.element;
      var targetRect = getBoundingClientRect(target);
      var rootContainsTarget = this._rootContainsTarget(target);
      var oldEntry = item.entry;
      var intersectionRect =
        rootIsInDom &&
        rootContainsTarget &&
        this._computeTargetAndRootIntersection(target, rootRect);

      var newEntry = (item.entry = new IntersectionObserverEntry({
        time: now(),
        target: target,
        boundingClientRect: targetRect,
        rootBounds: rootRect,
        intersectionRect: intersectionRect,
      }));

      if (!oldEntry) {
        this._queuedEntries.push(newEntry);
      } else if (rootIsInDom && rootContainsTarget) {
        // If the new entry intersection ratio has crossed any of the
        // thresholds, add a new entry.
        if (this._hasCrossedThreshold(oldEntry, newEntry)) {
          this._queuedEntries.push(newEntry);
        }
      } else {
        // If the root is not in the DOM or target is not contained within
        // root but the previous entry for this target had an intersection,
        // add a new record indicating removal.
        if (oldEntry && oldEntry.isIntersecting) {
          this._queuedEntries.push(newEntry);
        }
      }
    }, this);

    if (this._queuedEntries.length) {
      this._callback(this.takeRecords(), this);
    }
  };

  /**
   * Accepts a target and root rect computes the intersection between then
   * following the algorithm in the spec.
   * TODO(philipwalton): at this time clip-path is not considered.
   * https://w3c.github.io/IntersectionObserver/#calculate-intersection-rect-algo
   * @param {Element} target The target DOM element
   * @param {Object} rootRect The bounding rect of the root after being
   *     expanded by the rootMargin value.
   * @return {?Object} The final intersection rect object or undefined if no
   *     intersection is found.
   * @private
   */
  IntersectionObserver.prototype._computeTargetAndRootIntersection = function (
    target,
    rootRect
  ) {
    // If the element isn't displayed, an intersection can't happen.
    if (window.getComputedStyle(target).display == 'none') return;

    var targetRect = getBoundingClientRect(target);
    var intersectionRect = targetRect;
    var parent = getParentNode(target);
    var atRoot = false;

    while (!atRoot) {
      var parentRect = null;
      var parentComputedStyle =
        parent.nodeType == 1 ? window.getComputedStyle(parent) : {};

      // If the parent isn't displayed, an intersection can't happen.
      if (parentComputedStyle.display == 'none') return;

      if (parent == this.root || parent == document) {
        atRoot = true;
        parentRect = rootRect;
      } else {
        // If the element has a non-visible overflow, and it's not the <body>
        // or <html> element, update the intersection rect.
        // Note: <body> and <html> cannot be clipped to a rect that's not also
        // the document rect, so no need to compute a new intersection.
        if (
          parent != document.body &&
          parent != document.documentElement &&
          parentComputedStyle.overflow != 'visible'
        ) {
          parentRect = getBoundingClientRect(parent);
        }
      }

      // If either of the above conditionals set a new parentRect,
      // calculate new intersection data.
      if (parentRect) {
        intersectionRect = computeRectIntersection(
          parentRect,
          intersectionRect
        );

        if (!intersectionRect) break;
      }
      parent = getParentNode(parent);
    }
    return intersectionRect;
  };

  /**
   * Returns the root rect after being expanded by the rootMargin value.
   * @return {Object} The expanded root rect.
   * @private
   */
  IntersectionObserver.prototype._getRootRect = function () {
    var rootRect;
    if (this.root) {
      rootRect = getBoundingClientRect(this.root);
    } else {
      // Use <html>/<body> instead of window since scroll bars affect size.
      var html = document.documentElement;
      var body = document.body;
      rootRect = {
        top: 0,
        left: 0,
        right: html.clientWidth || body.clientWidth,
        width: html.clientWidth || body.clientWidth,
        bottom: html.clientHeight || body.clientHeight,
        height: html.clientHeight || body.clientHeight,
      };
    }
    return this._expandRectByRootMargin(rootRect);
  };

  /**
   * Accepts a rect and expands it by the rootMargin value.
   * @param {Object} rect The rect object to expand.
   * @return {Object} The expanded rect.
   * @private
   */
  IntersectionObserver.prototype._expandRectByRootMargin = function (rect) {
    var margins = this._rootMarginValues.map(function (margin, i) {
      return margin.unit == 'px'
        ? margin.value
        : (margin.value * (i % 2 ? rect.width : rect.height)) / 100;
    });
    var newRect = {
      top: rect.top - margins[0],
      right: rect.right + margins[1],
      bottom: rect.bottom + margins[2],
      left: rect.left - margins[3],
    };
    newRect.width = newRect.right - newRect.left;
    newRect.height = newRect.bottom - newRect.top;

    return newRect;
  };

  /**
   * Accepts an old and new entry and returns true if at least one of the
   * threshold values has been crossed.
   * @param {?IntersectionObserverEntry} oldEntry The previous entry for a
   *    particular target element or null if no previous entry exists.
   * @param {IntersectionObserverEntry} newEntry The current entry for a
   *    particular target element.
   * @return {boolean} Returns true if a any threshold has been crossed.
   * @private
   */
  IntersectionObserver.prototype._hasCrossedThreshold = function (
    oldEntry,
    newEntry
  ) {
    // To make comparing easier, an entry that has a ratio of 0
    // but does not actually intersect is given a value of -1
    var oldRatio =
      oldEntry && oldEntry.isIntersecting
        ? oldEntry.intersectionRatio || 0
        : -1;
    var newRatio = newEntry.isIntersecting
      ? newEntry.intersectionRatio || 0
      : -1;

    // Ignore unchanged ratios
    if (oldRatio === newRatio) return;

    for (var i = 0; i < this.thresholds.length; i++) {
      var threshold = this.thresholds[i];

      // Return true if an entry matches a threshold or if the new ratio
      // and the old ratio are on the opposite sides of a threshold.
      if (
        threshold == oldRatio ||
        threshold == newRatio ||
        threshold < oldRatio !== threshold < newRatio
      ) {
        return true;
      }
    }
  };

  /**
   * Returns whether or not the root element is an element and is in the DOM.
   * @return {boolean} True if the root element is an element and is in the DOM.
   * @private
   */
  IntersectionObserver.prototype._rootIsInDom = function () {
    return !this.root || containsDeep(document, this.root);
  };

  /**
   * Returns whether or not the target element is a child of root.
   * @param {Element} target The target element to check.
   * @return {boolean} True if the target element is a child of root.
   * @private
   */
  IntersectionObserver.prototype._rootContainsTarget = function (target) {
    return containsDeep(this.root || document, target);
  };

  /**
   * Adds the instance to the global IntersectionObserver registry if it isn't
   * already present.
   * @private
   */
  IntersectionObserver.prototype._registerInstance = function () {
    if (registry.indexOf(this) < 0) {
      registry.push(this);
    }
  };

  /**
   * Removes the instance from the global IntersectionObserver registry.
   * @private
   */
  IntersectionObserver.prototype._unregisterInstance = function () {
    var index = registry.indexOf(this);
    if (index != -1) registry.splice(index, 1);
  };

  /**
   * Returns the result of the performance.now() method or null in browsers
   * that don't support the API.
   * @return {number} The elapsed time since the page was requested.
   */
  function now() {
    return window.performance && performance.now && performance.now();
  }

  /**
   * Throttles a function and delays its execution, so it's only called at most
   * once within a given time period.
   * @param {Function} fn The function to throttle.
   * @param {number} timeout The amount of time that must pass before the
   *     function can be called again.
   * @return {Function} The throttled function.
   */
  function throttle(fn, timeout) {
    var timer = null;
    return function () {
      if (!timer) {
        timer = setTimeout(function () {
          fn();
          timer = null;
        }, timeout);
      }
    };
  }

  /**
   * Adds an event handler to a DOM node ensuring cross-browser compatibility.
   * @param {Node} node The DOM node to add the event handler to.
   * @param {string} event The event name.
   * @param {Function} fn The event handler to add.
   * @param {boolean} opt_useCapture Optionally adds the even to the capture
   *     phase. Note: this only works in modern browsers.
   */
  function addEvent(node, event, fn, opt_useCapture) {
    if (typeof node.addEventListener == 'function') {
      node.addEventListener(event, fn, opt_useCapture || false);
    } else if (typeof node.attachEvent == 'function') {
      node.attachEvent('on' + event, fn);
    }
  }

  /**
   * Removes a previously added event handler from a DOM node.
   * @param {Node} node The DOM node to remove the event handler from.
   * @param {string} event The event name.
   * @param {Function} fn The event handler to remove.
   * @param {boolean} opt_useCapture If the event handler was added with this
   *     flag set to true, it should be set to true here in order to remove it.
   */
  function removeEvent(node, event, fn, opt_useCapture) {
    if (typeof node.removeEventListener == 'function') {
      node.removeEventListener(event, fn, opt_useCapture || false);
    } else if (typeof node.detatchEvent == 'function') {
      node.detatchEvent('on' + event, fn);
    }
  }

  /**
   * Returns the intersection between two rect objects.
   * @param {Object} rect1 The first rect.
   * @param {Object} rect2 The second rect.
   * @return {?Object} The intersection rect or undefined if no intersection
   *     is found.
   */
  function computeRectIntersection(rect1, rect2) {
    var top = Math.max(rect1.top, rect2.top);
    var bottom = Math.min(rect1.bottom, rect2.bottom);
    var left = Math.max(rect1.left, rect2.left);
    var right = Math.min(rect1.right, rect2.right);
    var width = right - left;
    var height = bottom - top;

    return (
      width >= 0 &&
      height >= 0 && {
        top: top,
        bottom: bottom,
        left: left,
        right: right,
        width: width,
        height: height,
      }
    );
  }

  /**
   * Shims the native getBoundingClientRect for compatibility with older IE.
   * @param {Element} el The element whose bounding rect to get.
   * @return {Object} The (possibly shimmed) rect of the element.
   */
  function getBoundingClientRect(el) {
    var rect;

    try {
      rect = el.getBoundingClientRect();
    } catch (err) {
      // Ignore Windows 7 IE11 "Unspecified error"
      // https://github.com/w3c/IntersectionObserver/pull/205
    }

    if (!rect) return getEmptyRect();

    // Older IE
    if (!(rect.width && rect.height)) {
      rect = {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
      };
    }
    return rect;
  }

  /**
   * Returns an empty rect object. An empty rect is returned when an element
   * is not in the DOM.
   * @return {Object} The empty rect.
   */
  function getEmptyRect() {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
    };
  }

  /**
   * Checks to see if a parent element contains a child element (including inside
   * shadow DOM).
   * @param {Node} parent The parent element.
   * @param {Node} child The child element.
   * @return {boolean} True if the parent node contains the child node.
   */
  function containsDeep(parent, child) {
    var node = child;
    while (node) {
      if (node == parent) return true;

      node = getParentNode(node);
    }
    return false;
  }

  /**
   * Gets the parent node of an element or its host element if the parent node
   * is a shadow root.
   * @param {Node} node The node whose parent to get.
   * @return {Node|null} The parent node or null if no parent exists.
   */
  function getParentNode(node) {
    var parent = node.parentNode;

    if (parent && parent.nodeType == 11 && parent.host) {
      // If the parent is a shadow root, return the host element.
      return parent.host;
    }

    if (parent && parent.assignedSlot) {
      // If the parent is distributed in a <slot>, return the parent of a slot.
      return parent.assignedSlot.parentNode;
    }

    return parent;
  }

  // Exposes the constructors globally.
  window.IntersectionObserver = IntersectionObserver;
  window.IntersectionObserverEntry = IntersectionObserverEntry;
})();

/*! ie11CustomProperties.js v3.1.0 | MIT License | https://git.io/fjXMN */
!(function () {
  'use strict';

  // check for support
  var testEl = document.createElement('i');
  testEl.style.setProperty('--x', 'y');
  if (testEl.style.getPropertyValue('--x') === 'y' || !testEl.msMatchesSelector)
    return;

  if (!Element.prototype.matches)
    Element.prototype.matches = Element.prototype.msMatchesSelector;

  var listeners = [],
    root = document,
    Observer;

  function qsa(el, selector) {
    try {
      return el.querySelectorAll(selector);
    } catch (e) {
      // console.warn('the Selector '+selector+' can not be parsed');
      return [];
    }
  }
  function onElement(selector, callback) {
    var listener = {
      selector: selector,
      callback: callback,
      elements: new WeakMap(),
    };
    var els = qsa(root, listener.selector),
      i = 0,
      el;
    while ((el = els[i++])) {
      listener.elements.set(el, true);
      listener.callback.call(el, el);
    }
    listeners.push(listener);
    if (!Observer) {
      Observer = new MutationObserver(checkMutations);
      Observer.observe(root, {
        childList: true,
        subtree: true,
      });
    }
    checkListener(listener);
  }
  function checkListener(listener, target) {
    var i = 0,
      el,
      els = [];
    try {
      target && target.matches(listener.selector) && els.push(target);
    } catch (e) {}
    if (loaded) {
      // ok? check inside node on innerHTML - only when loaded
      Array.prototype.push.apply(els, qsa(target || root, listener.selector));
    }
    while ((el = els[i++])) {
      if (listener.elements.has(el)) continue;
      listener.elements.set(el, true);
      listener.callback.call(el, el);
    }
  }
  function checkListeners(inside) {
    var i = 0,
      listener;
    while ((listener = listeners[i++])) checkListener(listener, inside);
  }
  function checkMutations(mutations) {
    var j = 0,
      i,
      mutation,
      nodes,
      target;
    while ((mutation = mutations[j++])) {
      (nodes = mutation.addedNodes), (i = 0);
      while ((target = nodes[i++]))
        target.nodeType === 1 && checkListeners(target);
    }
  }

  var loaded = false;
  document.addEventListener('DOMContentLoaded', function () {
    loaded = true;
  });

  // svg polyfills
  function copyProperty(prop, from, to) {
    var desc = Object.getOwnPropertyDescriptor(from, prop);
    Object.defineProperty(to, prop, desc);
  }
  if (!('classList' in Element.prototype)) {
    copyProperty('classList', HTMLElement.prototype, Element.prototype);
  }
  if (!('innerHTML' in Element.prototype)) {
    copyProperty('innerHTML', HTMLElement.prototype, Element.prototype);
  }
  if (!('sheet' in SVGStyleElement.prototype)) {
    Object.defineProperty(SVGStyleElement.prototype, 'sheet', {
      get: function () {
        var all = document.styleSheets,
          i = 0,
          sheet;
        while ((sheet = all[i++])) {
          if (sheet.ownerNode === this) return sheet;
        }
      },
    });
  }

  // main logic

  // cached regexps, better performance
  const regFindSetters = /([\s{;])(--([A-Za-z0-9-_]*)\s*:([^;!}{]+)(!important)?)(?=\s*([;}]|$))/g;
  const regFindGetters = /([{;]\s*)([A-Za-z0-9-_]+\s*:[^;}{]*var\([^!;}{]+)(!important)?(?=\s*([;}$]|$))/g;
  const regRuleIEGetters = /-ieVar-([^:]+):/g;
  const regRuleIESetters = /-ie-([^};]+)/g;
  //const regHasVar = /var\(/;
  const regPseudos = /:(hover|active|focus|target|visited|link|:before|:after|:first-letter|:first-line)/;

  onElement('link[rel="stylesheet"]', function (el) {
    fetchCss(el.href, function (css) {
      var newCss = rewriteCss(css);
      if (css === newCss) return;
      newCss = relToAbs(el.href, newCss);
      el.disabled = true;
      var style = document.createElement('style');
      if (el.media) style.setAttribute('media', el.media);
      el.parentNode.insertBefore(style, el);
      activateStyleElement(style, newCss);
    });
  });

  function foundStyle(el) {
    if (el.ieCP_polyfilled) return;
    if (el.ieCP_elementSheet) return;
    var css = el.innerHTML;
    var newCss = rewriteCss(css);
    if (css === newCss) return;
    activateStyleElement(el, newCss);
  }
  onElement('style', foundStyle);
  // immediate, to pass w3c-tests, bud its a bad idea
  // addEventListener('DOMNodeInserted',function(e){ e.target.tagName === 'STYLE' && foundStyle(e.target); });

  onElement('[ie-style]', function (el) {
    var newCss = rewriteCss('{' + el.getAttribute('ie-style')).substr(1);
    el.style.cssText += ';' + newCss;
    var found = parseRewrittenStyle(el.style);
    if (found.getters) addGetterElement(el, found.getters, '%styleAttr');
    if (found.setters) addSetterElement(el, found.setters);
  });

  function relToAbs(base, css) {
    return css.replace(/url\(([^)]+)\)/g, function ($0, $1) {
      $1 = $1.trim().replace(/(^['"]|['"]$)/g, '');
      if ($1.match(/^([a-z]+:|\/)/)) return $0;
      base = base.replace(/\?.*/, '');
      return 'url(' + base + './../' + $1 + ')';
    });
  }

  // ie has a bug, where unknown properties at pseudo-selectors are computed at the element
  // #el::after { -content:'x'; } => getComputedStyle(el)['-content'] == 'x'
  // should we add something like -ieVar-pseudo_after-content:'x'?
  function rewriteCss(css) {
    /* uncomment if spec finished and needed by someone
		css = css.replace(/@property ([^{]+){([^}]+)}/, function($0, prop, body){
			prop = prop.trim();
			const declaration = {name:prop};
			body.split(';').forEach(function(pair){
				const x = pair.split(':');
				if (x[1]) declaration[ x[0].trim() ] = x[1];
			});
			declaration['inherits'] = declaration['inherits'].trim()==='true' ? true : false;
			declaration['initialValue'] = declaration['initial-value'];
			CSS.registerProperty(declaration)
			return '/*\n @property ... removed \n*'+'/';
		});
		*/
    return css
      .replace(regFindSetters, function ($0, $1, $2, $3, $4, important) {
        return (
          $1 + '-ie-' + (important ? '❗' : '') + $3 + ':' + encodeValue($4)
        );
      })
      .replace(regFindGetters, function ($0, $1, $2, important) {
        return $1 + '-ieVar-' + (important ? '❗' : '') + $2 + '; ' + $2; // keep the original, so chaining works "--x:var(--y)"
      });
  }
  function encodeValue(value) {
    return value;
    return value.replace(/ /g, '␣');
  }
  const keywords = { initial: 1, inherit: 1, revert: 1, unset: 1 };
  function decodeValue(value) {
    return value;
    if (value === undefined) return;
    value = value.replace(/␣/g, ' ');
    const trimmed = value.trim();
    if (keywords[trimmed]) return trimmed;
    return value;
  }

  // beta
  const styles_of_getter_properties = {};

  function parseRewrittenStyle(style) {
    // less memory then parameter cssText?

    // beta
    style['z-index']; // ie11 can access unknown properties in stylesheets only if accessed a dashed known property

    const cssText = style.cssText;
    var matchesGetters = cssText.match(regRuleIEGetters),
      j,
      match;
    if (matchesGetters) {
      var getters = []; // eg. [border,color]
      for (j = 0; (match = matchesGetters[j++]); ) {
        let propName = match.slice(7, -1);
        if (propName[0] === '❗') propName = propName.substr(1);
        getters.push(propName);

        // beta
        if (!styles_of_getter_properties[propName])
          styles_of_getter_properties[propName] = [];
        styles_of_getter_properties[propName].push(style);
      }
    }
    var matchesSetters = cssText.match(regRuleIESetters);
    if (matchesSetters) {
      var setters = {}; // eg. [--color:#fff, --padding:10px];
      for (j = 0; (match = matchesSetters[j++]); ) {
        let x = match.substr(4).split(':');
        let propName = x[0];
        let propValue = x[1];
        if (propName[0] === '❗') propName = propName.substr(1);
        setters[propName] = propValue;
      }
    }
    return { getters: getters, setters: setters };
  }
  function activateStyleElement(style, css) {
    style.innerHTML = css;
    style.ieCP_polyfilled = true;
    var rules = style.sheet.rules,
      i = 0,
      rule; // cssRules = CSSRuleList, rules = MSCSSRuleList
    while ((rule = rules[i++])) {
      const found = parseRewrittenStyle(rule.style);
      if (found.getters) addGettersSelector(rule.selectorText, found.getters);
      if (found.setters) addSettersSelector(rule.selectorText, found.setters);

      // mediaQueries: redraw the hole document
      // better add events for each element?
      const media =
        rule.parentRule &&
        rule.parentRule.media &&
        rule.parentRule.media.mediaText;
      if (media && (found.getters || found.setters)) {
        matchMedia(media).addListener(function () {
          drawTree(document.documentElement);
        });
      }
    }

    // beta
    redrawStyleSheets();
  }

  function addGettersSelector(selector, properties) {
    selectorAddPseudoListeners(selector);
    onElement(unPseudo(selector), function (el) {
      addGetterElement(el, properties, selector);
      drawElement(el);
    });
  }
  function addGetterElement(el, properties, selector) {
    var i = 0,
      prop,
      j;
    const selectors = selector.split(','); // split grouped selectors
    el.setAttribute('iecp-needed', true);
    if (!el.ieCPSelectors) el.ieCPSelectors = {};
    while ((prop = properties[i++])) {
      for (j = 0; (selector = selectors[j++]); ) {
        const parts = selector.trim().split('::');
        if (!el.ieCPSelectors[prop]) el.ieCPSelectors[prop] = [];
        el.ieCPSelectors[prop].push({
          selector: parts[0],
          pseudo: parts[1] ? '::' + parts[1] : '',
        });
      }
    }
  }
  function addSettersSelector(selector, propVals) {
    selectorAddPseudoListeners(selector);
    onElement(unPseudo(selector), function (el) {
      addSetterElement(el, propVals);
    });
  }
  function addSetterElement(el, propVals) {
    if (!el.ieCP_setters) el.ieCP_setters = {};
    for (var prop in propVals) {
      // eg. {foo:#fff, bar:baz}
      el.ieCP_setters['--' + prop] = 1;
    }
    drawTree(el);
  }

  //beta
  function redrawStyleSheets() {
    for (var prop in styles_of_getter_properties) {
      let styles = styles_of_getter_properties[prop];
      for (var i = 0, style; (style = styles[i++]); ) {
        if (style.owningElement) continue;
        var value = style['-ieVar-' + prop];
        if (!value) continue;
        value = styleComputeValueWidthVars(
          getComputedStyle(document.documentElement),
          value
        );
        if (value === '') continue;
        try {
          style[prop] = value;
        } catch (e) {}
      }
    }
  }

  const pseudos = {
    hover: {
      on: 'mouseenter',
      off: 'mouseleave',
    },
    focus: {
      on: 'focusin',
      off: 'focusout',
    },
    active: {
      on: 'CSSActivate',
      off: 'CSSDeactivate',
    },
  };
  function selectorAddPseudoListeners(selector) {
    // ie11 has the strange behavoir, that groups of selectors are individual rules, but starting with the full selector:
    // td, th, button { color:red } results in this rules:
    // "td, th, button" | "th, th" | "th"
    selector = selector.split(',')[0];
    for (var pseudo in pseudos) {
      var parts = selector.split(':' + pseudo);
      if (parts.length > 1) {
        var ending = parts[1].match(/^[^\s]*/); // ending elementpart of selector (used for not(:active))
        let sel = unPseudo(parts[0] + ending);
        const listeners = pseudos[pseudo];
        onElement(sel, function (el) {
          el.addEventListener(listeners.on, drawTreeEvent);
          el.addEventListener(listeners.off, drawTreeEvent);
        });
      }
    }
  }
  let CSSActive = null;
  document.addEventListener('mousedown', function (e) {
    setTimeout(function () {
      if (e.target === document.activeElement) {
        var evt = document.createEvent('Event');
        evt.initEvent('CSSActivate', true, true);
        CSSActive = e.target;
        CSSActive.dispatchEvent(evt);
      }
    });
  });
  document.addEventListener('mouseup', function () {
    if (CSSActive) {
      var evt = document.createEvent('Event');
      evt.initEvent('CSSDeactivate', true, true);
      CSSActive.dispatchEvent(evt);
      CSSActive = null;
    }
  });

  function unPseudo(selector) {
    return selector.replace(regPseudos, '').replace(':not()', '');
  }

  var uniqueCounter = 0;

  /* old *
	function _drawElement(el) {
		if (!el.ieCP_unique) { // use el.uniqueNumber? but needs class for the css-selector => test performance
			el.ieCP_unique = ++uniqueCounter;
			el.classList.add('iecp-u' + el.ieCP_unique);
		}
		var style = getComputedStyle(el);
		if (el.ieCP_sheet) while (el.ieCP_sheet.rules[0]) el.ieCP_sheet.deleteRule(0);
		for (var prop in el.ieCPSelectors) {
			var important = style['-ieVar-❗' + prop];
			let valueWithVar = important || style['-ieVar-' + prop];
			if (!valueWithVar) continue; // todo, what if '0'

			var details = {};
			var value = styleComputeValueWidthVars(style, valueWithVar, details);

			if (important) value += ' !important';
			for (var i=0, item; item=el.ieCPSelectors[prop][i++];) { // todo: split and use requestAnimationFrame?
				if (item.selector === '%styleAttr') {
					el.style[prop] = value;
				} else {

					// beta
					if (!important && details.allByRoot !== false) continue; // dont have to draw root-properties

					//let selector = item.selector.replace(/>? \.[^ ]+/, ' ', item.selector); // todo: try to equalize specificity
					let selector = item.selector;
					elementStyleSheet(el).insertRule(selector + '.iecp-u' + el.ieCP_unique + item.pseudo + ' {' + prop + ':' + value + '}', 0);
				}
			}
		}
	}
	function elementStyleSheet(el){
		if (!el.ieCP_sheet) {
			const styleEl = document.createElement('style');
			styleEl.ieCP_elementSheet = 1;
			//el.appendChild(styleEl); // yes! self-closing tags can have style as children, but - if i set innerHTML, the stylesheet is lost
			document.head.appendChild(styleEl);
			el.ieCP_sheet = styleEl.sheet;
		}
		return el.ieCP_sheet;
	}

	/* */
  function _drawElement(el) {
    if (!el.ieCP_unique) {
      // use el.uniqueNumber? but needs class for the css-selector => test performance
      el.ieCP_unique = ++uniqueCounter;
      el.classList.add('iecp-u' + el.ieCP_unique);
    }
    var style = getComputedStyle(el);
    let css = '';
    for (var prop in el.ieCPSelectors) {
      var important = style['-ieVar-❗' + prop];
      let valueWithVar = important || style['-ieVar-' + prop];
      if (!valueWithVar) continue; // todo, what if '0'
      var details = {};
      var value = styleComputeValueWidthVars(style, valueWithVar, details);
      //if (value==='initial') value = initials[prop];
      if (important) value += ' !important';
      for (var i = 0, item; (item = el.ieCPSelectors[prop][i++]); ) {
        // todo: split and use requestAnimationFrame?
        if (item.selector === '%styleAttr') {
          el.style[prop] = value;
        } else {
          // beta
          if (!important && details.allByRoot !== false) continue; // dont have to draw root-properties

          //let selector = item.selector.replace(/>? \.[^ ]+/, ' ', item.selector); // todo: try to equalize specificity
          let selector = item.selector;
          css +=
            selector +
            '.iecp-u' +
            el.ieCP_unique +
            item.pseudo +
            '{' +
            prop +
            ':' +
            value +
            '}\n';
        }
      }
    }
    elementSetCss(el, css);
  }
  function elementSetCss(el, css) {
    if (!el.ieCP_styleEl && css) {
      const styleEl = document.createElement('style');
      styleEl.ieCP_elementSheet = 1;
      //el.appendChild(styleEl); // yes! self-closing tags can have style as children, but - if i set innerHTML, the stylesheet is lost
      document.head.appendChild(styleEl);
      el.ieCP_styleEl = styleEl;
    }
    if (el.ieCP_styleEl) el.ieCP_styleEl.innerHTML = css;
  }
  /* */

  function drawTree(target) {
    if (!target) return;
    var els = target.querySelectorAll('[iecp-needed]');
    if (target.hasAttribute && target.hasAttribute('iecp-needed'))
      drawElement(target); // self
    for (var i = 0, el; (el = els[i++]); ) drawElement(el); // tree
  }
  // draw queue
  let drawQueue = new Set();
  let collecting = false;
  let drawing = false;
  function drawElement(el) {
    drawQueue.add(el);
    if (collecting) return;
    collecting = true;
    requestAnimationFrame(function () {
      //setImmediate(function(){
      collecting = false;
      drawing = true;
      drawQueue.forEach(_drawElement);
      drawQueue.clear();
      setTimeout(function () {
        // mutationObserver will trigger delayed, requestAnimationFrame will miss some changes
        drawing = false;
      });
    });
  }

  function drawTreeEvent(e) {
    drawTree(e.target);
  }

  function findVars(str, cb) {
    // css value parser
    let level = 0,
      openedLevel = null,
      lastPoint = 0,
      newStr = '',
      i = 0,
      char,
      insideCalc;
    while ((char = str[i++])) {
      if (char === '(') {
        ++level;
        if (
          openedLevel === null &&
          str[i - 4] + str[i - 3] + str[i - 2] === 'var'
        ) {
          openedLevel = level;
          newStr += str.substring(lastPoint, i - 4);
          lastPoint = i;
        }
        if (str[i - 5] + str[i - 4] + str[i - 3] + str[i - 2] === 'calc') {
          insideCalc = level;
        }
      }
      if (char === ')' && openedLevel === level) {
        let variable = str.substring(lastPoint, i - 1).trim(),
          fallback;
        let x = variable.indexOf(',');
        if (x !== -1) {
          fallback = variable.slice(x + 1);
          variable = variable.slice(0, x);
        }
        newStr += cb(variable, fallback, insideCalc);
        lastPoint = i;
        openedLevel = null;
      }
      if (char === ')') {
        --level;
        if (insideCalc === level) insideCalc = null;
      }
    }
    newStr += str.substring(lastPoint);
    return newStr;
  }
  function styleComputeValueWidthVars(style, valueWithVars, details) {
    return findVars(valueWithVars, function (variable, fallback, insideCalc) {
      var value = style.getPropertyValue(variable);
      if (insideCalc) value = value.replace(/^calc\(/, '('); // prevent nested calc
      if (details && style.lastPropertyServedBy !== document.documentElement)
        details.allByRoot = false;
      if (value === '' && fallback)
        value = styleComputeValueWidthVars(style, fallback, details);
      return value;
    });
  }

  // mutation listener
  var observer = new MutationObserver(function (mutations) {
    if (drawing) return;
    for (var i = 0, mutation; (mutation = mutations[i++]); ) {
      if (mutation.attributeName === 'iecp-needed') continue; // why?
      // recheck all selectors if it targets new elements?
      drawTree(mutation.target);
    }
  });
  setTimeout(function () {
    observer.observe(document, { attributes: true, subtree: true });
  });

  // :target listener
  var oldHash = location.hash;
  addEventListener('hashchange', function (e) {
    var newEl = document.getElementById(location.hash.substr(1));
    if (newEl) {
      var oldEl = document.getElementById(oldHash.substr(1));
      drawTree(newEl);
      drawTree(oldEl);
    } else {
      drawTree(document);
    }
    oldHash = location.hash;
  });

  // add owningElement to Element.style
  var descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'style'
  );
  var styleGetter = descriptor.get;
  descriptor.get = function () {
    const style = styleGetter.call(this);
    style.owningElement = this;
    return style;
  };
  Object.defineProperty(HTMLElement.prototype, 'style', descriptor);

  // add computedFor to computed style-objects
  var originalGetComputed = getComputedStyle;
  window.getComputedStyle = function (el) {
    var style = originalGetComputed.apply(this, arguments);
    style.computedFor = el;
    //style.pseudoElt = pseudoElt; //not needed at the moment
    return style;
  };

  // getPropertyValue / setProperty hooks
  const StyleProto = CSSStyleDeclaration.prototype;

  const oldGetP = StyleProto.getPropertyValue;
  StyleProto.getPropertyValue = function (property) {
    this.lastPropertyServedBy = false;
    property = property.trim();

    /* *
		if (this.owningElement) {
			const ieProperty = '-ieVar-'+property;
			const iePropertyImportant = '-ieVar-❗'+property;
			let value = this[iePropertyImportant] || this[ieProperty];
			if (value !== undefined) {
				// todo, test if syntax valid
				return value;
			}
		}
		/* */

    if (property[0] !== '-' || property[1] !== '-')
      return oldGetP.apply(this, arguments);
    const undashed = property.substr(2);
    const ieProperty = '-ie-' + undashed;
    const iePropertyImportant = '-ie-❗' + undashed;
    let value = decodeValue(this[iePropertyImportant] || this[ieProperty]);

    if (this.computedFor) {
      // computedStyle
      if (value !== undefined && !inheritingKeywords[value]) {
        //if (regHasVar.test(value))  // todo: to i need this check?!!! i think its faster without
        value = styleComputeValueWidthVars(this, value);
        this.lastPropertyServedBy = this.computedFor;
      } else {
        // inherited
        if (
          inheritingKeywords[value] ||
          !register[property] ||
          register[property].inherits
        ) {
          //let el = this.pseudoElt ? this.computedFor : this.computedFor.parentNode;
          let el = this.computedFor.parentNode;
          while (el.nodeType === 1) {
            // how slower would it be to getComputedStyle for every element, not just with defined ieCP_setters
            if (el.ieCP_setters && el.ieCP_setters[property]) {
              // i could make
              // value = el.nodeType ? getComputedStyle(this.computedFor.parentNode).getPropertyValue(property)
              // but i fear performance, stupid?
              var style = getComputedStyle(el);
              var tmpVal = decodeValue(
                style[iePropertyImportant] || style[ieProperty]
              );
              if (tmpVal !== undefined) {
                // calculated style from current element not from the element the value was inherited from! (style, value)
                //value = tmpVal; if (regHasVar.test(tmpVal))  // todo: to i need this check?!!! i think its faster without
                value = styleComputeValueWidthVars(this, tmpVal);
                this.lastPropertyServedBy = el;
                break;
              }
            }
            el = el.parentNode;
          }
        }
      }
      if (value === 'initial') return '';
    }
    //if ((value === undefined || value === 'initial') && register[property]) value = register[property].initialValue; // todo?
    if (value === undefined && register[property])
      value = register[property].initialValue;
    if (value === undefined) return '';
    return value;
  };
  const inheritingKeywords = { inherit: 1, revert: 1, unset: 1 };

  const oldSetP = StyleProto.setProperty;
  StyleProto.setProperty = function (property, value, prio) {
    if (property[0] !== '-' || property[1] !== '-')
      return oldSetP.apply(this, arguments);
    const el = this.owningElement;
    if (el) {
      if (!el.ieCP_setters) el.ieCP_setters = {};
      el.ieCP_setters[property] = 1;
    }
    property = '-ie-' + (prio === 'important' ? '❗' : '') + property.substr(2);
    this.cssText += '; ' + property + ':' + encodeValue(value) + ';';
    //this[property] = value;
    el === document.documentElement && redrawStyleSheets();
    el && drawTree(el); // its delayed internal
  };

  /*
	var descriptor = Object.getOwnPropertyDescriptor(StyleProto, 'cssText');
	var cssTextGetter = descriptor.get;
	var cssTextSetter = descriptor.set;
	// descriptor.get = function () {
	// 	const style = styleGetter.call(this);
	// 	style.owningElement = this;
	// 	return style;
	// }
	descriptor.set = function (css) {
		var el = this.owningElement;
		if (el) {
			css = rewriteCss('{'+css).substr(1);
			cssTextSetter.call(this, css);
			var found = parseRewrittenStyle(this);
			if (found.getters) addGetterElement(el, found.getters, '%styleAttr');
			if (found.setters) addSetterElement(el, found.setters);
			return;
		}
		return cssTextSetter.call(this, css);
	}
	Object.defineProperty(StyleProto, 'cssText', descriptor);
	*/

  if (!window.CSS) window.CSS = {};
  const register = {};
  CSS.registerProperty = function (options) {
    register[options.name] = options;
  };

  // fix "initial" keyword with generated custom properties, this is not supported ad all by ie, should i make a separate "inherit"-polyfill?
  /*
	const computed = getComputedStyle(document.documentElement)
	const initials = {};
	for (let i in computed) {
		initials[i.replace(/([A-Z])/, function(x){ return '-'+x.toLowerCase(x) })] = computed[i];
	}
	initials['display'] = 'inline';
	*/

  // utils
  function fetchCss(url, callback) {
    var request = new XMLHttpRequest();
    request.open('GET', url);
    request.overrideMimeType('text/css');
    request.onload = function () {
      if (request.status >= 200 && request.status < 400) {
        callback(request.responseText);
      }
    };
    request.send();
  }
})();

(function () {
  if (typeof window.CustomEvent === 'function') return false; //If not IE

  function CustomEvent(event, params) {
    params = params || { bubbles: false, cancelable: false, detail: undefined };
    var evt = document.createEvent('CustomEvent');
    evt.initCustomEvent(
      event,
      params.bubbles,
      params.cancelable,
      params.detail
    );
    return evt;
  }

  CustomEvent.prototype = window.Event.prototype;

  window.CustomEvent = CustomEvent;
})();

Element.prototype.remove = function () {
  this.parentElement.removeChild(this);
};
NodeList.prototype.remove = HTMLCollection.prototype.remove = function () {
  for (var i = this.length - 1; i >= 0; i--) {
    if (this[i] && this[i].parentElement) {
      this[i].parentElement.removeChild(this[i]);
    }
  }
};
