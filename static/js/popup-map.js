/* Pop-Up Pots venue map (Leaflet). Loaded only via layouts/shortcodes/map-tab.html.
   Kilnfire's embeds never expose real coordinates/addresses - only a venue name
   baked into each session's title. This matches that title text against
   static/json/pop-up-pots-venues.json (our own maintained directory of known
   partner venues); anything not in that directory is skipped (logged to the
   console) rather than guessed - a live geocoding fallback was tried and
   removed after it mismatched a same-named venue in a different state. */
(function () {
  var VENUES_URL = '/json/pop-up-pots-venues.json';
  var SOURCE_SELECTOR = '.kilnfire-upcoming-classes[data-template-id="1641"]';

  var mapContainer = document.getElementById('dps-popup-map');
  if (!mapContainer) { return; }

  var mapInitialized = false;
  var leafletMap = null;
  var venueMarkers = {};

  function isVisible(el) {
    return el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  // Walk actual text nodes rather than using .textContent (concatenates
  // everything with no boundaries) or .innerText (layout-dependent -
  // returns empty for anything inside a display:none ancestor, which the
  // modal this reads from always is until opened). Each text node becomes
  // its own segment, so adjacent-but-unspaced markup still gets a
  // separator between logically distinct pieces.
  function collectTextParts(el) {
    var parts = [];
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var text = node.nodeValue.trim();
      if (text) { parts.push(text); }
    }
    return parts;
  }

  function matchVenue(title, venues) {
    var lower = title.toLowerCase();
    for (var i = 0; i < venues.length; i++) {
      var aliases = venues[i].match || [];
      for (var j = 0; j < aliases.length; j++) {
        if (lower.indexOf(aliases[j].toLowerCase()) !== -1) {
          return venues[i];
        }
      }
    }
    return null;
  }

  // No visible pin/dot at all - the label's own oversized arrow (see
  // .dps-map-label) is the only marker, anchored with zero size directly
  // on the exact coordinate so the arrow tip lands right on it.
  var pinIcon = L.divIcon({
    className: 'dps-map-pin',
    html: '',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -8],
    tooltipAnchor: [0, -8]
  });

  // "459 Islington St, Portsmouth, NH 03801" -> "Portsmouth, NH"
  function cityState(address) {
    if (!address) { return ''; }
    var parts = address.split(',');
    if (parts.length < 3) { return ''; }
    var city = parts[1].trim();
    var state = parts[2].trim().split(' ')[0];
    return city + ', ' + state;
  }

  // Session titles are standardized "Venue: What we're building" - the venue
  // is already the popup heading, so only show the part after the colon.
  // Falls back to the full title for any older/non-conforming event names.
  function sessionLabel(title) {
    var idx = title.indexOf(':');
    return idx === -1 ? title : title.slice(idx + 1).trim();
  }

  // Pulls "Aug" and "29" out of the raw date text Kilnfire renders
  // ("Saturday, Aug 29, 2026 * 1:00 PM - 3:00 PM") and formats as
  // "Aug-29" for the compact always-on pin label (the popup still shows
  // the full text).
  function shortDate(dateText) {
    var m = dateText.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/);
    if (!m) { return null; }
    var day = m[2].length === 1 ? '0' + m[2] : m[2];
    return m[1] + '-' + day;
  }

  function uniqueShortDates(sessions) {
    var seen = {};
    var out = [];
    sessions.forEach(function (s) {
      var d = shortDate(s.date);
      if (d && !seen[d]) {
        seen[d] = true;
        out.push(d);
      }
    });
    return out;
  }

  function updateLabel(entry) {
    var html = '<span class="dps-map-label-name">' + entry.venue.name + '</span>';
    var dates = uniqueShortDates(entry.sessions);
    if (dates.length) {
      html += '<span class="dps-map-label-dates">' + dates.join(', ') + '</span>';
    }
    entry.marker.setTooltipContent(html);
  }

  function updatePopup(entry) {
    var html = '<div class="dps-map-popup">';
    html += '<div class="dps-map-popup-venue">' + entry.venue.name + '</div>';
    if (entry.venue.address) {
      html += '<div class="dps-map-popup-address">' + entry.venue.address + '</div>';
    }
    html += '<ul class="dps-map-popup-sessions">';
    entry.sessions.forEach(function (s) {
      var label = sessionLabel(s.title);
      var titleHtml = s.href
        ? '<a class="dps-map-popup-session-link" href="' + s.href + '">' + label + '</a>'
        : label;
      html += '<li><span class="dps-map-popup-session-title">' + titleHtml + '</span>'
        + '<span class="dps-map-popup-session-date">' + s.date + '</span></li>';
    });
    html += '</ul></div>';
    entry.marker.bindPopup(html, { maxWidth: 320, minWidth: 260, className: 'dps-map-popup-window' });
  }

  // Two venues can sit close enough together (e.g. Chapman Tavern and
  // Stage Neck Inn, both in York/York Harbor) that their always-on name
  // labels overlap if both float directly above their pin. Nudge a new
  // venue's label out to the side instead when an already-placed venue is
  // within this rough distance - a plain lat/lng delta is good enough at
  // the scale this map operates at, no need for real haversine math.
  var LABEL_COLLISION_THRESHOLD = 0.02;

  function isNearExistingVenue(venue) {
    return Object.keys(venueMarkers).some(function (key) {
      var other = venueMarkers[key].venue;
      return Math.abs(other.lat - venue.lat) < LABEL_COLLISION_THRESHOLD
        && Math.abs(other.lng - venue.lng) < LABEL_COLLISION_THRESHOLD;
    });
  }

  function addSession(venue, title, dateText, href) {
    var key = venue.name;
    var isNewVenue = !venueMarkers[key];
    if (isNewVenue) {
      var marker = L.marker([venue.lat, venue.lng], { icon: pinIcon }).addTo(leafletMap);
      // The label is the prominent, clickable part of each marker now -
      // wire the click-to-open-popup handler via the "tooltipopen" event
      // rather than grabbing marker.getTooltip().getElement() once right
      // after bindTooltip(): that one-shot grab is timing-fragile (it
      // assumed the permanent tooltip's DOM container is created
      // synchronously and never replaced), which is why it silently never
      // fired. "tooltipopen" fires whenever the tooltip's element actually
      // exists, including any future re-opens, and interactive: true tells
      // Leaflet itself not to swallow pointer events on the tooltip (its
      // default CSS sets pointer-events: none on tooltips that don't ask
      // for interactivity).
      marker.on('tooltipopen', function (e) {
        var el = e.tooltip.getElement();
        if (el && !el._dpsClickWired) {
          el._dpsClickWired = true;
          el.addEventListener('click', function () { marker.openPopup(); });
        }
      });
      if (isNearExistingVenue(venue)) {
        // Icon's tooltipAnchor ([0, -8], tuned for the default top
        // placement) still applies underneath this offset (they add
        // together), so this cancels the upward bias back out and
        // re-anchors level with the coordinate instead of above it:
        // [0, -8] + [10, 8] = [10, 0], level with the point, offset right.
        marker.bindTooltip(venue.name, {
          permanent: true,
          interactive: true,
          direction: 'right',
          offset: [10, 8],
          className: 'dps-map-label'
        });
      } else {
        marker.bindTooltip(venue.name, {
          permanent: true,
          interactive: true,
          direction: 'top',
          className: 'dps-map-label'
        });
      }
      venueMarkers[key] = { marker: marker, venue: venue, sessions: [] };
    }
    venueMarkers[key].sessions.push({ title: title, date: dateText, href: href });
    updatePopup(venueMarkers[key]);
    updateLabel(venueMarkers[key]);
    if (isNewVenue) { renderLegend(); }
  }

  var legendControl = null;
  var legendDiv = null;
  var legendCollapsed = true;

  function renderLegend() {
    if (!legendDiv) { return; }
    var entries = Object.keys(venueMarkers).map(function (key) { return venueMarkers[key]; });
    entries.sort(function (a, b) { return a.venue.name.localeCompare(b.venue.name); });

    var html = '<div class="dps-map-legend-header"><strong>Venues</strong>'
      + '<span class="dps-map-legend-toggle">' + (legendCollapsed ? '+' : '−') + '</span></div>';
    html += '<ul>';
    entries.forEach(function (entry, i) {
      var loc = cityState(entry.venue.address);
      html += '<li data-venue-key="' + i + '">' + entry.venue.name + (loc ? '<span class="dps-map-legend-loc">' + loc + '</span>' : '') + '</li>';
    });
    html += '</ul>';
    legendDiv.innerHTML = html;
    legendDiv.classList.toggle('is-collapsed', legendCollapsed);

    var toggleEl = legendDiv.querySelector('.dps-map-legend-toggle');
    legendDiv.querySelector('.dps-map-legend-header').addEventListener('click', function () {
      legendCollapsed = !legendCollapsed;
      legendDiv.classList.toggle('is-collapsed', legendCollapsed);
      toggleEl.textContent = legendCollapsed ? '+' : '−';
    });

    Array.prototype.forEach.call(legendDiv.querySelectorAll('[data-venue-key]'), function (li, i) {
      li.addEventListener('click', function () {
        var entry = entries[i];
        leafletMap.panTo(entry.marker.getLatLng());
        entry.marker.openPopup();
      });
    });
  }

  function initLegend() {
    legendControl = L.control({ position: 'bottomright' });
    legendControl.onAdd = function () {
      legendDiv = L.DomUtil.create('div', 'dps-map-legend');
      L.DomEvent.disableClickPropagation(legendDiv);
      return legendDiv;
    };
    legendControl.addTo(leafletMap);
  }

  var processedKeys = {};

  function processRows(rows, venues) {
    rows.forEach(function (li) {
      var titleEl = li.querySelector('.kilnfire-class-list-title');
      if (!titleEl) { return; }

      var title = titleEl.textContent.trim();
      var leftEl = li.querySelector('.kilnfire-class-list-left');
      var dateText = '';
      if (leftEl) {
        var parts = collectTextParts(leftEl).filter(function (part) { return part !== title; });
        dateText = parts.join(' • ');
      }

      // Kilnfire sometimes re-renders the whole list (replacing DOM nodes),
      // which would defeat a per-element "already processed" flag - key
      // dedup on the actual content instead.
      var key = title + '|' + dateText;
      if (processedKeys[key]) { return; }
      processedKeys[key] = true;

      var venue = matchVenue(title, venues);
      if (!venue) {
        console.warn('[Pop-Up Pots map] "' + title + '" doesn\'t match any venue in static/json/pop-up-pots-venues.json - add it there to show this session on the map.');
        return;
      }

      var linkEl = li.querySelector('.kilnfire-class-list-button');
      var href = linkEl && linkEl.href ? linkEl.href : null;
      addSession(venue, title, dateText, href);
    });
  }

  function watchForRows(venues) {
    var source = document.querySelector(SOURCE_SELECTOR);
    if (!source) {
      console.warn('[Pop-Up Pots map] Could not find the Kilnfire upcoming-classes widget for template 1641.');
      return;
    }

    function scan() {
      var rows = source.querySelectorAll('.kilnfire-class-list-inside > li');
      if (rows.length) { processRows(rows, venues); }
    }

    scan();
    new MutationObserver(scan).observe(source, { childList: true, subtree: true });
  }

  // Fetching is idempotent/cached so initMap() can be safely retried - see
  // below for why a retry is necessary.
  var venuesPromise = null;
  function loadVenues() {
    if (!venuesPromise) {
      venuesPromise = fetch(VENUES_URL).then(function (r) { return r.json(); });
    }
    return venuesPromise;
  }

  function initMap() {
    if (mapInitialized) { return; }

    loadVenues().then(function (data) {
      // *** THE ACTUAL ROOT CAUSE (confirmed live via devtools) ***
      // popup-map.js's <script> tag is emitted inline inside the page's
      // content (by the map-tab shortcode), which puts it earlier in
      // document order - and therefore earlier in DOMContentLoaded
      // listener registration order - than main.js's own listener
      // (main.js loads later, from footer.html). Listeners for the same
      // event fire in registration order, so at the moment maybeInit()'s
      // isVisible() gate (below) runs, main.js's initTabs() hasn't
      // tabified the tab-pane-source markup yet - per tabs.css, that
      // pre-tabification state has no display:none, so the container
      // genuinely IS visible and correctly sized at that instant, and the
      // gate passes. But the fetch above is async: while it's in flight,
      // main.js's listener runs next, converts the panes, and hides every
      // non-active one (this map's included) - so by the time this .then()
      // callback runs, the container is truly 0x0 (not a stale cache -
      // verified live: offsetWidth/Height read 778x750 at the gate and
      // 0x0 here, moments later). invalidateSize()/fitBounds() against a
      // really-zero-size container is what produced the degenerate
      // maxZoom(18)/single-tile/off-screen-pins result seen in every
      // previous attempt - and since mapInitialized used to be set
      // synchronously up front, the later real tab click never got a
      // chance to retry.
      //
      // Fix: re-check visibility here, right before actually building the
      // map, and only commit to construction (mapInitialized = true) once
      // that check passes against the map's TRUE state. If it fails, bail
      // out without marking initialized - maybeInit() runs again on the
      // user's actual tab click (see the click listener below), at which
      // point the container is genuinely visible and this retries against
      // the cached venuesPromise.
      if (!isVisible(mapContainer) || mapInitialized) { return; }
      mapInitialized = true;

      // Finer zoomSnap so the hand-picked "zoom" value below (and the
      // scroll/pinch zoom controls) aren't limited to whole numbers.
      leafletMap = L.map('dps-popup-map', { zoomSnap: 0.25 });
      // Still worth keeping as a defensive measure for any other timing
      // wrinkle (e.g. late web font metrics affecting layout) - harmless
      // now that we only reach this point against a container confirmed
      // visible.
      leafletMap.invalidateSize();
      // Hand-set rather than computed from the venues (fitBounds kept
      // landing at an unnecessarily zoomed-out view once label padding was
      // factored in, and there's no automatic way to route around two
      // labels overlapping). Tweak "center"/"zoom" in
      // static/json/pop-up-pots-venues.json directly whenever the venue
      // list changes enough to throw the framing off.
      leafletMap.setView(data.center || [43.05, -70.75], data.zoom || 9);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
      }).addTo(leafletMap);

      // Re-measure one more time after the browser's next paint. The tab
      // pane's display:none -> block flip and this map's own construction
      // both happen synchronously above, but on some browsers the container
      // hasn't actually finished laying out until the following frame -
      // if Leaflet grabs a stale size before that, it only requests enough
      // tiles to cover the wrong (smaller) area.
      window.requestAnimationFrame(function () {
        leafletMap.invalidateSize();
      });

      initLegend();
      watchForRows(data.venues || []);
    });
  }

  function maybeInit() {
    if (!mapInitialized && isVisible(mapContainer)) {
      initMap();
    }
  }

  // The tabs system (main.js initTabs) attaches its own click listener
  // directly to each generated nav link, which fires during the "target"
  // phase before this document-level bubble-phase listener runs - so by
  // the time this fires, the tab switch (and container visibility) has
  // already happened.
  document.addEventListener('click', function (e) {
    if (e.target.closest('.nav-tabs a')) {
      maybeInit();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeInit);
  } else {
    maybeInit();
  }
})();
