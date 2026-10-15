// Pure validation: this module never calls TikTok or reads credentials.
export function publishingEnabled(env) {
  return env.TIKTOK_MODE === "production" && env.PUBLISHING_ENABLED === "true";
}

export function validatePostSettings(form, creator) {
  const title = form.get("title");
  const privacy = form.get("privacy_level");
  if (typeof title !== "string" || !title.trim() || title.length > 2200) {
    throw new Error("Escribe una descripción de hasta 2200 caracteres.");
  }
  if (!(creator.privacy_level_options || []).includes(privacy)) {
    throw new Error("Selecciona la privacidad entre las opciones actuales de TikTok.");
  }
  if (form.get("consent") !== "yes" || form.get("music_consent") !== "yes") {
    throw new Error("Confirma los derechos, la publicación y el uso de música.");
  }
  const commercial = form.get("commercial_content") === "true";
  const ownBrand = form.get("own_brand") === "true";
  const paidPartnership = form.get("branded_content") === "true";
  if (commercial && !ownBrand && !paidPartnership) {
    throw new Error("Indica si el contenido promociona tu marca, una marca ajena o ambas.");
  }
  if (!commercial && (ownBrand || paidPartnership)) {
    throw new Error("Activa la declaración de contenido comercial.");
  }
  if (paidPartnership && (privacy === "SELF_ONLY" || form.get("branded_consent") !== "yes")) {
    throw new Error("Una colaboración pagada requiere visibilidad no privada y aceptar la política de contenido de marca.");
  }
  return {
    title, privacy_level: privacy,
    disable_comment: form.get("allow_comment") !== "true" || !!creator.comment_disabled,
    disable_duet: form.get("allow_duet") !== "true" || !!creator.duet_disabled,
    disable_stitch: form.get("allow_stitch") !== "true" || !!creator.stitch_disabled,
    brand_organic_toggle: commercial && ownBrand,
    brand_content_toggle: commercial && paidPartnership,
  };
}

// Read MP4 movie duration from mvhd; reject malformed or unbounded boxes.
// Check actual file bytes rather than trusting a duration submitted by a client.
export function mp4Duration(buffer) {
  const view = new DataView(buffer);
  const kind = offset => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  let boxes = 0;
  function scan(start, end, insideMoov = false) {
    for (let pos = start; pos + 8 <= end;) {
      if (++boxes > 10000) throw new Error("MP4 demasiado complejo.");
      let size = view.getUint32(pos), header = 8;
      const type = kind(pos + 4);
      if (size === 1) {
        if (pos + 16 > end) throw new Error("Cabecera MP4 incompleta.");
        const wide = view.getBigUint64(pos + 8);
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Tamaño MP4 no válido.");
        size = Number(wide); header = 16;
      } else if (size === 0) size = end - pos;
      if (size < header || size > end - pos) throw new Error("Estructura MP4 no válida.");
      const data = pos + header;
      if (type === "moov" && !insideMoov) {
        const result = scan(data, pos + size, true);
        if (result != null) return result;
      }
      if (type === "mvhd" && insideMoov) {
        if (data + 4 > pos + size) throw new Error("Duración MP4 incompleta.");
        const version = view.getUint8(data);
        if (![0, 1].includes(version)) throw new Error("Versión MP4 no compatible.");
        const timescaleAt = data + (version === 1 ? 20 : 12);
        const durationAt = timescaleAt + 4;
        const width = version === 1 ? 8 : 4;
        if (durationAt + width > pos + size) throw new Error("Duración MP4 incompleta.");
        const timescale = view.getUint32(timescaleAt);
        const duration = version === 1 ? Number(view.getBigUint64(durationAt)) : view.getUint32(durationAt);
        if (!timescale || !duration || duration === (version === 1 ? Number(0xffffffffffffffffn) : 0xffffffff)) {
          throw new Error("El MP4 debe tener una duración definida.");
        }
        const seconds = duration / timescale;
        if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Duración MP4 no válida.");
        return seconds;
      }
      pos += size;
    }
    return null;
  }
  const duration = scan(0, buffer.byteLength);
  if (duration == null) throw new Error("No se pudo leer la duración del MP4. Exporta un MP4 estándar.");
  return duration;
}
