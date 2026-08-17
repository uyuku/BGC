import { getAutocompleteSuggestions } from './geocoder.js';

let activeMenu = null;
let activeInput = null;
let activeIndex = -1;
let currentSuggestions = [];

export function closeAutocompleteMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  activeInput = null;
  activeIndex = -1;
  currentSuggestions = [];
}

function updateActiveItem() {
  if (!activeMenu) return;
  const items = activeMenu.querySelectorAll('.bgc-autocomplete-item');
  items.forEach((it, idx) => {
    if (idx === activeIndex) {
      it.classList.add('is-active');
      it.scrollIntoView({ block: 'nearest' });
    } else {
      it.classList.remove('is-active');
    }
  });
}

export function attachAutocomplete(jellyInputEl, mode = 'air', onSelect = null) {
  if (!jellyInputEl) return;

  const getTargetInput = () => jellyInputEl.shadowRoot?.querySelector('input') || jellyInputEl;

  const chooseSuggestion = (chosen) => {
    if (!chosen) {
      closeAutocompleteMenu();
      return;
    }
    jellyInputEl._lastSelectedVal = chosen.value;
    jellyInputEl._suppressAutocomplete = true;
    closeAutocompleteMenu();
    if (onSelect) {
      onSelect(chosen.value, chosen);
    }
    setTimeout(() => {
      jellyInputEl._suppressAutocomplete = false;
    }, 300);
  };

  const showSuggestions = () => {
    if (jellyInputEl._suppressAutocomplete) {
      return;
    }

    // Do NOT show if element is hidden, disconnected, or has 0 dimensions
    const rect = jellyInputEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || (rect.top === 0 && rect.left === 0 && rect.bottom === 0)) {
      closeAutocompleteMenu();
      return;
    }

    // Do NOT show if element or its inner input is not actively focused by the user
    const targetInput = getTargetInput();
    const isFocused = document.activeElement === jellyInputEl ||
                      jellyInputEl.contains(document.activeElement) ||
                      document.activeElement === targetInput ||
                      jellyInputEl.shadowRoot?.activeElement === targetInput;
    if (!isFocused) {
      closeAutocompleteMenu();
      return;
    }

    const rawVal = (jellyInputEl.value || jellyInputEl.getAttribute('value') || targetInput.value || '').trim();
    if (rawVal.length < 2 || rawVal.toUpperCase() === (jellyInputEl._lastSelectedVal || '').toUpperCase()) {
      closeAutocompleteMenu();
      return;
    }

    const suggestions = getAutocompleteSuggestions(rawVal, 6, mode);
    if (!suggestions.length) {
      closeAutocompleteMenu();
      return;
    }

    currentSuggestions = suggestions;
    activeIndex = -1;
    activeInput = jellyInputEl;

    if (!activeMenu) {
      activeMenu = document.createElement('div');
      activeMenu.className = 'bgc-autocomplete-menu';
      document.body.appendChild(activeMenu);
    }

    activeMenu.style.top = `${rect.bottom + window.scrollY + 6}px`;
    activeMenu.style.left = `${rect.left + window.scrollX}px`;
    activeMenu.style.width = `${Math.max(rect.width, 280)}px`;

    activeMenu.innerHTML = suggestions.map((s, idx) => {
      const modeBadge = s.iata
        ? `<span class="bgc-ac-badge bgc-ac-badge--iata">${s.iata}</span>`
        : `<span class="bgc-ac-badge">${mode === 'sea' ? '⚓' : mode === 'road' ? '🚗' : '📍'}</span>`;

      return `
        <div class="bgc-autocomplete-item" data-idx="${idx}">
          <div class="bgc-ac-left">${modeBadge}</div>
          <div class="bgc-ac-body">
            <div class="bgc-ac-title">${s.title}</div>
            ${s.subtitle ? `<div class="bgc-ac-sub">${s.subtitle}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    activeMenu.querySelectorAll('.bgc-autocomplete-item').forEach(itemEl => {
      itemEl.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = parseInt(itemEl.getAttribute('data-idx'), 10);
        chooseSuggestion(currentSuggestions[idx]);
      });
      itemEl.addEventListener('mouseenter', () => {
        activeIndex = parseInt(itemEl.getAttribute('data-idx'), 10);
        updateActiveItem();
      });
    });
  };

  const handleInput = () => {
    if (jellyInputEl._suppressAutocomplete) return;
    const targetInput = getTargetInput();
    const rawVal = (jellyInputEl.value || jellyInputEl.getAttribute('value') || targetInput.value || '').trim();
    if (rawVal.toUpperCase() !== (jellyInputEl._lastSelectedVal || '').toUpperCase()) {
      jellyInputEl._lastSelectedVal = '';
    }
    setTimeout(showSuggestions, 50);
  };

  jellyInputEl.addEventListener('input', handleInput);
  const targetInputEl = getTargetInput();
  if (targetInputEl && targetInputEl !== jellyInputEl) {
    targetInputEl.addEventListener('input', handleInput);
  }

  const handleKeydown = (e) => {
    if (e.key === 'Enter') {
      if (activeMenu && activeInput === jellyInputEl && currentSuggestions.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        const selectedIdx = activeIndex >= 0 ? activeIndex : 0;
        chooseSuggestion(currentSuggestions[selectedIdx]);
        return;
      } else {
        closeAutocompleteMenu();
      }
    }

    if (!activeMenu || activeInput !== jellyInputEl) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentSuggestions.length;
      updateActiveItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
      updateActiveItem();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      closeAutocompleteMenu();
    }
  };

  jellyInputEl.addEventListener('keydown', handleKeydown);
  if (targetInputEl && targetInputEl !== jellyInputEl) {
    targetInputEl.addEventListener('keydown', handleKeydown);
  }
}

// Global click dismiss
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    if (activeMenu && !activeMenu.contains(e.target) && !activeInput?.contains(e.target)) {
      closeAutocompleteMenu();
    }
  });

  window.addEventListener('scroll', closeAutocompleteMenu, { passive: true });
  window.addEventListener('resize', closeAutocompleteMenu);
}
