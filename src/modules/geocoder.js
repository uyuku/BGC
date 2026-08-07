// 5. Temizlenmiş metin ile Nominatim Arama Fallback
  const geo = await geocodeNominatim(qClean);
  if (geo && geo.length) {
    const tLat = +geo[0].lat, tLon = +geo[0].lon;
    const placeName = geo[0].display_name.split(',')[0];
    const countryName = geo[0].display_name.split(',').slice(-1)[0].trim();

    if (mode === 'air') {
      const cityKey = normalizeStr(placeName);
      const rawKey = normalizeStr(qClean);
      
      // MAJOR_CITIES kontrolü (İstanbul, Paris, London vb. ana havalimanı yönlendirmesi)
      const preferred = MAJOR_CITIES[cityKey] || MAJOR_CITIES[rawKey];
      if (preferred && IATA[preferred.preferredIata]) {
        return { apt: IATA[preferred.preferredIata], method: 'Preferred Hub Airport' };
      }

      let best = null, minDist = Infinity;
      for (let i = 0; i < DB.length; i++) {
        if (DB[i].iata && DB[i].iata.length === 3) {
          const d = haversine(tLat, tLon, DB[i].lat, DB[i].lon);
          if (d < minDist) { minDist = d; best = DB[i]; }
        }
      }
      if (best && minDist < 250) {
        return { apt: best, method: 'Geocoded Airport Hub' };
      }
    }

    return {
      apt: {
        lat: tLat,
        lon: tLon,
        name: placeName,
        city: placeName,
        country: countryName
      },
      method: mode === 'sea' ? 'Coastal Port' : 'City Address'
    };
  }
