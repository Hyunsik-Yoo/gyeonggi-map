(function () {
  'use strict';

  const DEFAULT_CENTER = { lat: 37.4979, lng: 127.0276 }; // 강남역
  const DEFAULT_ZOOM = 14;
  const FOCUS_ZOOM = 15;

  let map;
  let userMarker = null;
  let userAccuracyCircle = null;
  let activeMarker = null;
  let activeOriginalIcon = null;
  let markerClusterer = null;

  const els = {
    loading: document.getElementById('loading'),
    locateBtn: document.getElementById('locate-btn'),
    sheet: document.getElementById('bottom-sheet'),
    sheetBackdrop: document.getElementById('sheet-backdrop'),
    sheetClose: document.getElementById('sheet-close'),
    title: document.getElementById('sheet-title'),
    region: document.getElementById('sheet-region'),
    keywords: document.getElementById('sheet-keywords'),
    rowAddress: document.getElementById('row-address'),
    rowPhone: document.getElementById('row-phone'),
    rowHomepage: document.getElementById('row-homepage'),
    coursesSection: document.getElementById('courses-section'),
    coursesList: document.getElementById('courses-list'),
    donateBtn: document.getElementById('donate-btn'),
    donateModal: document.getElementById('donate-modal'),
    donateClose: document.getElementById('donate-close'),
    donateCopy: document.getElementById('donate-copy'),
    logoBtn: document.getElementById('logo-btn'),
    aboutModal: document.getElementById('about-modal'),
    aboutClose: document.getElementById('about-close'),
  };

  const DONATE_URL = 'https://qr.kakaopay.com/Ej9JcHXpx';

  // ---------- Map init ----------
  function initMap() {
    map = new naver.maps.Map('map', {
      center: new naver.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
      zoom: DEFAULT_ZOOM,
      minZoom: 6,
      zoomControl: false,
      mapDataControl: false,
      logoControlOptions: { position: naver.maps.Position.BOTTOM_LEFT },
    });

    // Tap on empty map closes the sheet
    naver.maps.Event.addListener(map, 'click', () => closeSheet());
  }

  // ---------- CSV load ----------
  function loadData() {
    return new Promise((resolve, reject) => {
      Papa.parse('data.csv', {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = results.data
            .map(normalizeRow)
            .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
          resolve(rows);
        },
        error: (err) => {
          console.error('CSV load error:', err);
          reject(err);
        },
      });
    });
  }

  function normalizeRow(row) {
    const lat = parseFloat(row['위도']);
    const lng = parseFloat(row['경도']);
    return {
      name: (row['사용기관명'] || '').trim(),
      region: (row['지역'] || '').trim(),
      address: cleanAddress(row['주소'] || ''),
      homepage: cleanHomepage(row['홈페이지 주소'] || ''),
      phone: cleanPhone(row['전화번호'] || ''),
      keywords: splitList(row['검색 키워드'] || ''),
      courses: splitCourses(row['대표 강좌 이름'] || ''),
      lat,
      lng,
    };
  }

  function cleanAddress(s) {
    return s.replace(/\s*지도보기\s*$/, '').trim();
  }

  function cleanPhone(s) {
    return s.replace(/\s+/g, '').trim();
  }

  function cleanHomepage(s) {
    const t = s.trim();
    if (!t) return '';
    if (t.includes('@') && !t.startsWith('http')) return ''; // skip email-only values
    if (/^https?:\/\//i.test(t)) return t;
    return 'http://' + t;
  }

  function splitList(s) {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  function splitCourses(s) {
    return s.split('|').map((x) => x.trim()).filter(Boolean);
  }

  // ---------- Markers ----------
  function addMarkers(rows) {
    const markers = rows.map((row) => {
      const position = new naver.maps.LatLng(row.lat, row.lng);
      const marker = new naver.maps.Marker({
        position,
        title: row.name,
        icon: defaultMarkerIcon(),
      });

      naver.maps.Event.addListener(marker, 'click', () => {
        focusMarker(marker, row);
      });

      return marker;
    });

    markerClusterer = new MarkerClustering({
      map,
      markers,
      minClusterSize: 2,
      maxZoom: 16,
      gridSize: 120,
      disableClickZoom: false,
      averageCenter: true,
      icons: clusterIcons(),
      indexGenerator: [10, 50, 200, 1000],
      stylingFunction: (clusterMarker, count) => {
        const el = clusterMarker.getElement();
        if (!el) return;
        const label = el.querySelector('.cluster-count');
        if (label) label.textContent = count;
      },
    });
  }

  function defaultMarkerIcon() {
    return {
      content: `<div style="
        width:28px;height:28px;border-radius:50%;
        background:#1a73e8;border:3px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,0.3);
      "></div>`,
      size: new naver.maps.Size(28, 28),
      anchor: new naver.maps.Point(14, 14),
    };
  }

  function clusterIcons() {
    const tiers = [
      { size: 40, fontSize: 13, bg: '#4f8ff0' },
      { size: 48, fontSize: 14, bg: '#1a73e8' },
      { size: 56, fontSize: 15, bg: '#1557b0' },
      { size: 66, fontSize: 16, bg: '#0b3d91' },
      { size: 76, fontSize: 17, bg: '#062a6b' },
    ];
    return tiers.map((t) => ({
      content: `<div style="
        cursor:pointer;width:${t.size}px;height:${t.size}px;
        display:flex;align-items:center;justify-content:center;
        background:${t.bg};border:3px solid rgba(255,255,255,0.95);
        border-radius:50%;box-shadow:0 4px 12px rgba(0,0,0,0.25);
        color:#fff;font-weight:700;font-size:${t.fontSize}px;letter-spacing:-0.02em;
      "><span class="cluster-count"></span></div>`,
      size: new naver.maps.Size(t.size, t.size),
      anchor: new naver.maps.Point(t.size / 2, t.size / 2),
    }));
  }

  function activeMarkerIcon() {
    return {
      content: `<div style="
        width:36px;height:36px;border-radius:50%;
        background:#d93025;border:4px solid #fff;
        box-shadow:0 4px 10px rgba(0,0,0,0.35);
      "></div>`,
      size: new naver.maps.Size(36, 36),
      anchor: new naver.maps.Point(18, 18),
    };
  }

  function focusMarker(marker, row) {
    if (activeMarker && activeMarker !== marker) {
      activeMarker.setIcon(activeOriginalIcon || defaultMarkerIcon());
    }
    activeOriginalIcon = defaultMarkerIcon();
    activeMarker = marker;
    marker.setIcon(activeMarkerIcon());

    // Pan with an offset so the marker shows above the sheet
    const proj = map.getProjection();
    const pt = proj.fromCoordToOffset(marker.getPosition());
    const offsetY = window.innerHeight * 0.18; // shift up ~ 18% of viewport
    const newPt = new naver.maps.Point(pt.x, pt.y - offsetY);
    const newCenter = proj.fromOffsetToCoord(newPt);
    map.panTo(newCenter, { duration: 300 });

    openSheet(row);
  }

  // ---------- Bottom Sheet ----------
  function openSheet(row) {
    els.title.textContent = row.name || '이름 없음';
    els.region.textContent = row.region || '';
    els.region.style.display = row.region ? '' : 'none';

    // Keywords
    els.keywords.innerHTML = '';
    row.keywords.forEach((kw) => {
      const span = document.createElement('span');
      span.className = 'chip';
      span.textContent = '#' + kw;
      els.keywords.appendChild(span);
    });

    // Address
    setInfoRow(els.rowAddress, row.address, null);

    // Phone (tap to call)
    const phoneDigits = row.phone.replace(/[^0-9+]/g, '');
    setInfoRow(els.rowPhone, row.phone, phoneDigits ? 'tel:' + phoneDigits : null);

    // Homepage
    setInfoRow(els.rowHomepage, row.homepage, row.homepage || null, true);

    // Courses
    els.coursesList.innerHTML = '';
    if (row.courses.length > 0) {
      els.coursesSection.classList.remove('hidden');
      row.courses.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        els.coursesList.appendChild(li);
      });
    } else {
      els.coursesSection.classList.add('hidden');
    }

    els.sheet.classList.add('open');
    els.sheet.setAttribute('aria-hidden', 'false');
    els.sheetBackdrop.classList.add('open');
  }

  function setInfoRow(rowEl, value, href, external) {
    const textEl = rowEl.querySelector('.info-text');
    if (!value) {
      rowEl.classList.add('hidden');
      return;
    }
    rowEl.classList.remove('hidden');
    if (href && textEl.tagName === 'A') {
      textEl.textContent = value;
      textEl.setAttribute('href', href);
      if (external) {
        textEl.setAttribute('target', '_blank');
        textEl.setAttribute('rel', 'noopener noreferrer');
      }
    } else {
      // Replace anchor with span (or just set text if it's already a span)
      textEl.textContent = value;
      if (textEl.tagName === 'A') {
        textEl.removeAttribute('href');
      }
    }
  }

  function closeSheet() {
    els.sheet.classList.remove('open');
    els.sheet.setAttribute('aria-hidden', 'true');
    els.sheetBackdrop.classList.remove('open');
    if (activeMarker) {
      activeMarker.setIcon(defaultMarkerIcon());
      activeMarker = null;
    }
  }

  // ---------- Geolocation ----------
  function locateUser() {
    if (!navigator.geolocation) {
      alert('이 브라우저에서는 위치 기능을 사용할 수 없습니다.');
      return;
    }

    els.locateBtn.classList.add('loading-pulse');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        els.locateBtn.classList.remove('loading-pulse');
        const { latitude, longitude, accuracy } = pos.coords;
        const latLng = new naver.maps.LatLng(latitude, longitude);
        showUserLocation(latLng, accuracy);
        map.morph(latLng, FOCUS_ZOOM);
      },
      (err) => {
        els.locateBtn.classList.remove('loading-pulse');
        console.warn('Geolocation error:', err);
        const messages = {
          1: '위치 권한이 거부되었습니다. 브라우저 설정에서 위치 접근을 허용해주세요.',
          2: '현재 위치를 확인할 수 없습니다.',
          3: '위치 확인 시간이 초과되었습니다.',
        };
        alert(messages[err.code] || '위치를 가져올 수 없습니다.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  function showUserLocation(latLng, accuracy) {
    if (userMarker) {
      userMarker.setPosition(latLng);
    } else {
      userMarker = new naver.maps.Marker({
        position: latLng,
        map,
        icon: {
          content: `<div style="
            width:18px;height:18px;border-radius:50%;
            background:#4285f4;border:3px solid #fff;
            box-shadow:0 0 0 2px rgba(66,133,244,0.4), 0 2px 6px rgba(0,0,0,0.3);
          "></div>`,
          size: new naver.maps.Size(18, 18),
          anchor: new naver.maps.Point(9, 9),
        },
        zIndex: 1000,
      });
    }

    if (userAccuracyCircle) userAccuracyCircle.setMap(null);
    userAccuracyCircle = new naver.maps.Circle({
      map,
      center: latLng,
      radius: Math.min(accuracy || 50, 500),
      strokeColor: '#4285f4',
      strokeOpacity: 0.4,
      strokeWeight: 1,
      fillColor: '#4285f4',
      fillOpacity: 0.12,
    });
  }

  function requestInitialLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          const latLng = new naver.maps.LatLng(latitude, longitude);
          showUserLocation(latLng, accuracy);
          map.setCenter(latLng);
          resolve();
        },
        (err) => {
          console.warn('Initial geolocation unavailable, using default center:', err);
          resolve();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
  }

  // ---------- Helpers ----------
  function hideLoading() {
    els.loading.classList.add('hidden');
    setTimeout(() => {
      els.loading.style.display = 'none';
    }, 300);
  }

  // ---------- Donate Modal ----------
  function openDonateModal() {
    els.donateModal.classList.add('open');
    els.donateModal.setAttribute('aria-hidden', 'false');
  }

  function closeDonateModal() {
    els.donateModal.classList.remove('open');
    els.donateModal.setAttribute('aria-hidden', 'true');
  }

  function openAboutModal() {
    els.aboutModal.classList.add('open');
    els.aboutModal.setAttribute('aria-hidden', 'false');
  }

  function closeAboutModal() {
    els.aboutModal.classList.remove('open');
    els.aboutModal.setAttribute('aria-hidden', 'true');
  }

  async function copyDonateLink() {
    const btn = els.donateCopy;
    const label = btn.querySelector('.donate-option-label');
    const sub = btn.querySelector('.donate-option-sub');
    const originalLabel = label.textContent;
    const originalSub = sub.textContent;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(DONATE_URL);
      } else {
        const ta = document.createElement('textarea');
        ta.value = DONATE_URL;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      btn.classList.add('copied');
      label.textContent = '복사 완료!';
      sub.textContent = DONATE_URL;
      setTimeout(() => {
        btn.classList.remove('copied');
        label.textContent = originalLabel;
        sub.textContent = originalSub;
      }, 1800);
    } catch (err) {
      console.error('Copy failed:', err);
      alert('복사에 실패했어요. 직접 복사해주세요:\n' + DONATE_URL);
    }
  }

  // ---------- Wire up ----------
  function bind() {
    els.locateBtn.addEventListener('click', locateUser);
    els.sheetClose.addEventListener('click', closeSheet);
    els.sheetBackdrop.addEventListener('click', closeSheet);

    els.donateBtn.addEventListener('click', openDonateModal);
    els.donateClose.addEventListener('click', closeDonateModal);
    els.donateModal.querySelector('.modal-backdrop').addEventListener('click', closeDonateModal);
    els.donateCopy.addEventListener('click', copyDonateLink);

    els.logoBtn.addEventListener('click', openAboutModal);
    els.aboutClose.addEventListener('click', closeAboutModal);
    els.aboutModal.querySelector('.modal-backdrop').addEventListener('click', closeAboutModal);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeSheet();
        closeDonateModal();
        closeAboutModal();
      }
    });
  }

  // ---------- Boot ----------
  function boot() {
    if (typeof naver === 'undefined' || !naver.maps) {
      els.loading.textContent = '네이버 지도 API를 불러올 수 없습니다. API 키를 확인하세요.';
      return;
    }
    initMap();
    bind();

    // CSV와 위치권한을 병렬로 시작하되, 두 가지가 모두 끝난 뒤에야 마커를 올린다.
    // 그래야 클러스터가 최종 viewport(사용자 위치 또는 강남역 디폴트) 기준으로 만들어진다.
    Promise.all([loadData(), requestInitialLocation()])
      .then(([rows]) => {
        addMarkers(rows);
        hideLoading();
      })
      .catch((err) => {
        console.error('Init error:', err);
        els.loading.textContent = '데이터를 불러올 수 없습니다.';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
