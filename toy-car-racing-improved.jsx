
import { useEffect, useMemo, useRef, useState } from "react";

const PALETTE = [
  { name: "Rayo Rojo", hex: "#FF3B3B" },
  { name: "Turbo Azul", hex: "#2EA8FF" },
  { name: "Relámpago", hex: "#FFD93D" },
  { name: "Viperón", hex: "#38E07B" },
  { name: "Rosa Veloz", hex: "#FF5FCF" },
  { name: "Fuego", hex: "#FF8A1F" },
  { name: "Noche", hex: "#7C4DFF" },
  { name: "Acero", hex: "#8A95A6" },
];

const DEFAULT_MESSAGES = {
  idle: "Sube una foto de tu carro de juguete para añadirlo al garage.",
  scanning: "Escaneando el color, el brillo y el estilo del carro…",
  ready: "Listo para correr.",
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const num = parseInt(value, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r, g, b) {
  const toHex = (v) => v.toString(16).padStart(2, "0");
  return `#${toHex(clamp(Math.round(r), 0, 255))}${toHex(
    clamp(Math.round(g), 0, 255)
  )}${toHex(clamp(Math.round(b), 0, 255))}`.toUpperCase();
}

function brightnessOf({ r, g, b }) {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function hslFromRgb(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, l };
}

function pickPaletteName(hex) {
  const target = hexToRgb(hex);
  let best = PALETTE[0];
  let bestDist = Infinity;

  for (const candidate of PALETTE) {
    const c = hexToRgb(candidate.hex);
    const dist =
      (target.r - c.r) ** 2 + (target.g - c.g) ** 2 + (target.b - c.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

function seededRandom(seed) {
  let t = seed % 2147483647;
  if (t <= 0) t += 2147483646;
  return function () {
    t = (t * 16807) % 2147483647;
    return (t - 1) / 2147483646;
  };
}

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fileToCarProfile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read_error"));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image_error"));
    img.src = dataUrl;
  });

  const maxSide = 180;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const buckets = new Map();
  let total = 0;
  let totalBrightness = 0;
  let totalSat = 0;
  let brightest = 0;
  let darkest = 255;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 32) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = brightnessOf({ r, g, b });
    const { s } = hslFromRgb(r, g, b);
    const key = `${Math.round(r / 32) * 32}-${Math.round(g / 32) * 32}-${Math.round(
      b / 32
    ) * 32}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
    total += 1;
    totalBrightness += brightness;
    totalSat += s;
    brightest = Math.max(brightest, brightness);
    darkest = Math.min(darkest, brightness);
  }

  if (!total) {
    throw new Error("empty_image");
  }

  let dominantKey = [...buckets.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const [r0, g0, b0] = dominantKey.split("-").map(Number);
  let dominantHex = rgbToHex(r0, g0, b0);
  const palettePick = pickPaletteName(dominantHex);

  const avgBrightness = totalBrightness / total;
  const avgSat = totalSat / total;
  const contrast = (brightest - darkest) / 255;

  const speed = clamp(
    Math.round(56 + avgSat * 35 + contrast * 18 + (255 - avgBrightness) * 0.06),
    52,
    99
  );
  const acceleration = clamp(
    Math.round(4 + avgSat * 7 + contrast * 5 + (avgBrightness > 150 ? 1 : 0)),
    3,
    15
  );
  const handling = clamp(
    Math.round(50 + (100 - Math.abs(avgBrightness - 140)) * 0.3 + avgSat * 20),
    44,
    99
  );

  const styleLabel =
    avgSat > 0.6
      ? "muy llamativo"
      : avgBrightness < 90
      ? "más serio"
      : contrast > 0.4
      ? "con mucho carácter"
      : "equilibrado";

  const shape =
    image.width > image.height * 1.2
      ? "bajito y rápido"
      : image.height > image.width * 1.2
      ? "alto y estable"
      : "compacto";

  const name =
    `${palettePick.name} ${shape === "compacto" ? "GT" : shape === "bajito y rápido" ? "Sprint" : "Pro"}`;

  return {
    found: true,
    name,
    color: palettePick.name,
    hex: palettePick.hex,
    speed,
    acceleration,
    handling,
    description: `Perfil ${styleLabel}, ${shape}.`,
    imageUrl: dataUrl,
  };
}

function simulateRace(racers) {
  const rng = seededRandom(Date.now() % 1_000_000 + racers.length * 97);
  const frames = [];
  const states = racers.map((car, index) => ({
    id: car.id,
    pos: 0,
    speed: 0,
    maxSpeed: car.speed / 10 + 4.5,
    acceleration: car.acceleration / 22 + 0.28,
    handling: car.handling / 120,
    luck: 0.9 + index * 0.02,
    boost: 0,
  }));

  let done = false;
  let safety = 0;

  while (!done && safety < 900) {
    safety += 1;
    done = true;

    for (const state of states) {
      if (state.pos >= 100) continue;

      done = false;

      const startBurst = state.pos < 8 ? 0.3 : 0;
      const middleBoost = state.pos > 40 && state.pos < 72 ? 0.12 : 0;
      const finalPush = state.pos > 82 ? 0.55 : 0;

      const noise = (rng() - 0.5) * 0.12;
      state.boost = Math.max(0, state.boost * 0.92 + noise);

      state.speed = clamp(
        state.speed +
          state.acceleration +
          startBurst +
          middleBoost +
          finalPush +
          state.boost,
        0,
        state.maxSpeed + state.handling
      );

      const grip = 0.88 + state.handling * 0.18;
      state.pos = clamp(state.pos + state.speed * 0.62 * grip * state.luck, 0, 100);
    }

    frames.push(states.map((s) => ({ id: s.id, pos: s.pos })));
  }

  const last = frames[frames.length - 1] || [];
  const order = [...last].sort((a, b) => b.pos - a.pos).map((x) => x.id);
  const winnerId = order[0] ?? null;

  return {
    frames,
    order,
    winnerId,
  };
}

function CarSvg({ color = "#FF3B3B", size = 56 }) {
  return (
    <svg width={size} height={size * 0.55} viewBox="0 0 100 55" aria-hidden="true">
      <defs>
        <linearGradient id="carBody" x1="0" x2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect x="8" y="20" width="84" height="24" rx="10" fill="url(#carBody)" />
      <rect x="24" y="10" width="52" height="18" rx="7" fill={color} opacity="0.95" />
      <rect x="28" y="13" width="18" height="11" rx="3" fill="#DFF6FF" opacity="0.82" />
      <rect x="50" y="13" width="22" height="11" rx="3" fill="#DFF6FF" opacity="0.82" />
      <circle cx="25" cy="44" r="8.5" fill="#121212" />
      <circle cx="25" cy="44" r="4" fill="#4a4a4a" />
      <circle cx="75" cy="44" r="8.5" fill="#121212" />
      <circle cx="75" cy="44" r="4" fill="#4a4a4a" />
      <rect x="7" y="25" width="9" height="7" rx="2" fill="#ffe066" />
      <rect x="84" y="25" width="9" height="7" rx="2" fill="#ff6666" />
    </svg>
  );
}

export default function App() {
  const [screen, setScreen] = useState("garage");
  const [garage, setGarage] = useState([]);
  const [selected, setSelected] = useState([]);
  const [scanState, setScanState] = useState({ busy: false, message: DEFAULT_MESSAGES.idle });
  const [preview, setPreview] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [raceData, setRaceData] = useState(null);
  const [frame, setFrame] = useState(0);
  const [results, setResults] = useState(null);
  const [flashWinner, setFlashWinner] = useState(false);

  const fileRef = useRef(null);
  const raceTimer = useRef(null);
  const progressTimer = useRef(null);

  useEffect(() => {
    return () => {
      if (raceTimer.current) clearInterval(raceTimer.current);
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  const racersForRace = useMemo(() => {
    if (!garage.length) return [];
    const selectedCars = garage.filter((car) => selected.includes(car.id));
    if (selectedCars.length >= 2) return selectedCars.slice(0, 6);
    return garage.slice(0, Math.min(6, garage.length));
  }, [garage, selected]);

  const isRaceReady = racersForRace.length >= 2;

  const openPicker = () => fileRef.current?.click();

  const resetRaceTimers = () => {
    if (raceTimer.current) clearInterval(raceTimer.current);
    if (progressTimer.current) clearInterval(progressTimer.current);
  };

  const processFile = async (file) => {
    if (!file || !file.type?.startsWith("image/")) {
      setScanState({ busy: false, message: "Selecciona una imagen válida." });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setScanState({ busy: true, message: DEFAULT_MESSAGES.scanning });

    try {
      const profile = await fileToCarProfile(file);
      const car = {
        id: uid(),
        name: profile.name,
        color: profile.color,
        hex: profile.hex,
        speed: profile.speed,
        acceleration: profile.acceleration,
        handling: profile.handling,
        description: profile.description,
        imageUrl: objectUrl,
      };

      setGarage((current) => [car, ...current]);
      setScanState({ busy: false, message: `Auto añadido: ${car.name}` });
      setTimeout(() => {
        setPreview(null);
        setScanState({ busy: false, message: DEFAULT_MESSAGES.ready });
      }, 900);
    } catch {
      setScanState({
        busy: false,
        message: "No pude leer esa imagen. Prueba con otra foto de tu carro.",
      });
      setTimeout(() => setPreview(null), 1200);
    }
  };

  const handleFileInput = (e) => {
    processFile(e.target.files?.[0]);
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files?.[0]);
  };

  const toggleSelected = (id) => {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= 6) return current;
      return [...current, id];
    });
  };

  const startRace = () => {
    if (garage.length < 2) return;

    resetRaceTimers();
    const racers = racersForRace;

    if (racers.length < 2) return;

    const sim = simulateRace(racers);
    setRaceData(sim);
    setFrame(0);
    setResults(null);
    setFlashWinner(false);
    setScreen("race");
  };

  useEffect(() => {
    if (screen !== "race" || !raceData?.frames?.length) return;

    let index = 0;
    raceTimer.current = setInterval(() => {
      index += 1;
      setFrame(index);

      if (index >= raceData.frames.length - 1) {
        clearInterval(raceTimer.current);
        setTimeout(() => {
          setResults(raceData.order);
          setScreen("result");
          setFlashWinner(true);
          setTimeout(() => setFlashWinner(false), 800);
        }, 350);
      }
    }, 22);

    return () => {
      if (raceTimer.current) clearInterval(raceTimer.current);
    };
  }, [screen, raceData]);

  const currentPositions = (id) => {
    const currentFrame =
      raceData?.frames?.[Math.min(frame, Math.max(0, (raceData.frames.length || 1) - 1))] ||
      [];
    return currentFrame.find((entry) => entry.id === id)?.pos ?? 0;
  };

  const backToGarage = () => {
    resetRaceTimers();
    setScreen("garage");
    setResults(null);
    setRaceData(null);
  };

  const removeCar = (id) => {
    setGarage((current) => current.filter((car) => car.id !== id));
    setSelected((current) => current.filter((item) => item !== id));
  };

  const laneStep = 100 / Math.max(1, racersForRace.length);

  return (
    <div style={styles.root}>
      <div style={styles.glowA} />
      <div style={styles.glowB} />
      <div style={styles.texture} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFileInput}
      />

      <header style={styles.header}>
        <div>
          <div style={styles.brand}>TOY RACE</div>
          <div style={styles.brandSub}>Garage de carritos reales</div>
        </div>
        <div style={styles.headerActions}>
          {screen !== "garage" && (
            <button style={styles.ghostButton} onClick={backToGarage}>
              ← Volver
            </button>
          )}
          <button style={styles.primaryButton} onClick={openPicker}>
            + Agregar carro
          </button>
        </div>
      </header>

      <main style={styles.page}>
        {screen === "garage" && (
          <section style={styles.panel}>
            <div style={styles.hero}>
              <h1 style={styles.title}>Tu garage de carreras</h1>
              <p style={styles.subtitle}>
                Sube fotos de tus carros de juguete y el juego les crea un perfil para correr.
              </p>
            </div>

            <div style={styles.statusBar}>
              <span style={styles.statusDot} />
              <span>{scanState.message}</span>
              <span style={{ marginLeft: "auto", opacity: 0.8 }}>{garage.length} carros</span>
            </div>

            <div
              style={{
                ...styles.dropZone,
                borderColor: dragOver ? "#FFE15A" : "rgba(255,255,255,.18)",
              }}
              onClick={openPicker}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
            >
              <div style={styles.dropIcon}>📷</div>
              <div style={styles.dropTitle}>Toca o arrastra una foto</div>
              <div style={styles.dropText}>
                PNG, JPG o WEBP. También funciona con la cámara del teléfono.
              </div>
              <div style={styles.dropHint}>Tip: fotos con fondo claro suelen verse mejor.</div>
            </div>

            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>Garage</h2>
              <div style={styles.sectionMeta}>
                Selecciona hasta 6 para correr. Si no eliges nada, salen los primeros.
              </div>
            </div>

            {garage.length === 0 ? (
              <div style={styles.emptyState}>
                Todavía no hay carros. Agrega el primero para empezar la carrera.
              </div>
            ) : (
              <div style={styles.grid}>
                {garage.map((car, index) => {
                  const selectedIndex = selected.indexOf(car.id);
                  const isSelected = selectedIndex !== -1;
                  return (
                    <article
                      key={car.id}
                      style={{
                        ...styles.card,
                        borderColor: isSelected ? car.hex : "rgba(255,255,255,.06)",
                        boxShadow: isSelected ? `0 0 0 1px ${car.hex}55, 0 14px 40px ${car.hex}22` : "none",
                      }}
                      onClick={() => toggleSelected(car.id)}
                    >
                      {isSelected && (
                        <div style={{ ...styles.rankBadge, background: car.hex }}>
                          {selectedIndex + 1}
                        </div>
                      )}
                      <img src={car.imageUrl} alt={car.name} style={styles.photo} />
                      <div style={styles.cardTop}>
                        <div>
                          <div style={{ ...styles.carName, color: car.hex }}>{car.name}</div>
                          <div style={styles.carDesc}>{car.description}</div>
                        </div>
                        <button
                          style={styles.smallDanger}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeCar(car.id);
                          }}
                          title="Eliminar"
                        >
                          ✕
                        </button>
                      </div>
                      <div style={styles.stats}>
                        <div style={styles.statChip}>
                          <span>💨</span>
                          <strong>{car.speed}</strong>
                        </div>
                        <div style={styles.statChip}>
                          <span>⚡</span>
                          <strong>{car.acceleration}</strong>
                        </div>
                        <div style={styles.statChip}>
                          <span>🛞</span>
                          <strong>{car.handling}</strong>
                        </div>
                      </div>
                      <CarSvg color={car.hex} size={58} />
                    </article>
                  );
                })}

                <button
                  style={{
                    ...styles.addCard,
                    borderColor: dragOver ? "#FFE15A" : "rgba(255,255,255,.12)",
                  }}
                  onClick={openPicker}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div style={{ fontSize: 44 }}>➕</div>
                  <div style={styles.addCardTitle}>Agregar otro</div>
                  <div style={styles.addCardText}>Súmale más rivales al garage.</div>
                </button>
              </div>
            )}

            <button
              style={{
                ...styles.raceButton,
                opacity: isRaceReady ? 1 : 0.5,
                cursor: isRaceReady ? "pointer" : "not-allowed",
              }}
              onClick={startRace}
              disabled={!isRaceReady}
            >
              🏁 {selected.length >= 2 ? `Correr con ${selected.length} carros` : "Empezar carrera"}
            </button>
          </section>
        )}

        {screen === "race" && raceData && (
          <section style={styles.panel}>
            <h1 style={styles.title}>¡En carrera!</h1>
            <p style={styles.subtitle}>Las estadísticas de cada carro influyen en la velocidad final.</p>

            <div style={styles.trackWrap}>
              <div style={styles.finishLine}>🏁 META</div>
              <div style={styles.track}>
                {raceData.racers.map((car, index) => {
                  const rowHeight = laneStep;
                  const top = index * rowHeight + rowHeight * 0.12;
                  return (
                    <div
                      key={car.id}
                      style={{
                        ...styles.racer,
                        top: `${top}%`,
                        left: `calc(${Math.min(currentPositions(car.id), 93)}% - 28px)`,
                      }}
                    >
                      <CarSvg color={car.hex} size={42} />
                      <div style={{ ...styles.racerLabel, color: car.hex }}>{car.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={styles.laneBoard}>
              {raceData.racers.map((car) => (
                <div key={car.id} style={styles.laneRow}>
                  <div style={{ ...styles.laneName, color: car.hex }}>{car.name}</div>
                  <div style={styles.laneBar}>
                    <div
                      style={{
                        ...styles.laneFill,
                        width: `${currentPositions(car.id)}%`,
                        background: car.hex,
                      }}
                    />
                  </div>
                  <div style={styles.lanePct}>{Math.round(currentPositions(car.id))}%</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {screen === "result" && raceData && results && (
          <section style={styles.panel}>
            <h1 style={styles.title}>Resultados</h1>
            <p style={styles.subtitle}>El podio quedó listo.</p>

            <div style={styles.podiumCard}>
              {results.map((id, index) => {
                const car = raceData.racers.find((item) => item.id === id);
                if (!car) return null;
                return (
                  <div key={id} style={styles.resultRow}>
                    <div style={styles.medal}>
                      {["🥇", "🥈", "🥉"][index] || `${index + 1}°`}
                    </div>
                    <CarSvg color={car.hex} size={38} />
                    <div style={{ flex: 1 }}>
                      <div style={{ ...styles.resultName, color: car.hex }}>{car.name}</div>
                      <div style={styles.resultMeta}>
                        Velocidad {car.speed} · Aceleración {car.acceleration} · Manejo {car.handling}
                      </div>
                    </div>
                    <img src={car.imageUrl} alt="" style={styles.thumb} />
                  </div>
                );
              })}
            </div>

            <div style={{ ...styles.winBanner, opacity: flashWinner ? 1 : 0.92 }}>
              {raceData.racers.find((car) => car.id === results[0])?.name} ganó la carrera
            </div>

            <div style={styles.resultActions}>
              <button style={{ ...styles.primaryButton, flex: 1 }} onClick={startRace}>
                🔄 Revancha
              </button>
              <button
                style={{ ...styles.ghostButton, flex: 1, background: "rgba(255,255,255,.06)" }}
                onClick={() => {
                  setSelected([]);
                  setScreen("garage");
                }}
              >
                🏠 Garage
              </button>
            </div>
          </section>
        )}

        {preview && (
          <div style={styles.previewLayer} onClick={() => setPreview(null)}>
            <div style={styles.previewCard} onClick={(e) => e.stopPropagation()}>
              <img src={preview} alt="preview" style={styles.previewImage} />
              <div style={styles.previewText}>
                {scanState.busy ? "Analizando imagen..." : scanState.message}
              </div>
              {scanState.busy && <div style={styles.progress} />}
            </div>
          </div>
        )}
      </main>

      <style>{`
        @keyframes pulse {
          from { transform: scale(0.99); }
          to { transform: scale(1.01); }
        }
        @keyframes float {
          from { transform: translateY(0px); }
          to { transform: translateY(-6px); }
        }
        * { box-sizing: border-box; }
        body { margin: 0; }
        button, input { font: inherit; }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(82,104,255,.18), transparent 30%), linear-gradient(180deg, #090912, #05050B 70%)",
    color: "#fff",
    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    position: "relative",
    overflowX: "hidden",
  },
  glowA: {
    position: "fixed",
    inset: "-20% auto auto -10%",
    width: 320,
    height: 320,
    borderRadius: "50%",
    filter: "blur(80px)",
    background: "rgba(255, 95, 207, 0.14)",
    pointerEvents: "none",
  },
  glowB: {
    position: "fixed",
    right: "-12%",
    top: "20%",
    width: 360,
    height: 360,
    borderRadius: "50%",
    filter: "blur(90px)",
    background: "rgba(46, 168, 255, 0.12)",
    pointerEvents: "none",
  },
  texture: {
    position: "fixed",
    inset: 0,
    background:
      "repeating-linear-gradient(135deg, transparent 0 34px, rgba(255,255,255,0.02) 34px 35px)",
    pointerEvents: "none",
    opacity: 0.75,
  },
  header: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 18px",
    background: "rgba(6, 6, 10, 0.72)",
    backdropFilter: "blur(18px)",
    borderBottom: "1px solid rgba(255,255,255,.08)",
  },
  headerActions: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  brand: {
    fontSize: 28,
    fontWeight: 900,
    letterSpacing: 1.3,
    lineHeight: 1,
    background: "linear-gradient(90deg, #FF4D4D, #FFE15A, #49A6FF)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  brandSub: {
    fontSize: 12,
    opacity: 0.72,
    marginTop: 3,
  },
  page: {
    position: "relative",
    zIndex: 1,
    maxWidth: 760,
    margin: "0 auto",
    padding: "22px 16px 80px",
  },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    animation: "pulse .7s ease",
  },
  hero: {
    textAlign: "center",
    padding: "10px 0 4px",
  },
  title: {
    fontSize: 38,
    margin: 0,
    fontWeight: 900,
    letterSpacing: -0.5,
  },
  subtitle: {
    margin: "8px auto 0",
    maxWidth: 520,
    color: "rgba(255,255,255,.72)",
    lineHeight: 1.5,
  },
  statusBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 18,
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.08)",
    color: "rgba(255,255,255,.84)",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#62ff7a",
    boxShadow: "0 0 0 4px rgba(98,255,122,.14)",
    flexShrink: 0,
  },
  dropZone: {
    border: "2px dashed",
    borderRadius: 24,
    background: "rgba(255,255,255,.03)",
    minHeight: 220,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
    cursor: "pointer",
    transition: "border-color .2s ease, transform .2s ease",
  },
  dropIcon: { fontSize: 58 },
  dropTitle: { fontSize: 22, fontWeight: 800 },
  dropText: { color: "rgba(255,255,255,.7)", textAlign: "center" },
  dropHint: { color: "rgba(255,255,255,.45)", fontSize: 13, textAlign: "center" },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "end",
    gap: 10,
    flexWrap: "wrap",
  },
  sectionTitle: {
    margin: 0,
    fontSize: 24,
    fontWeight: 900,
  },
  sectionMeta: {
    color: "rgba(255,255,255,.58)",
    fontSize: 13,
  },
  emptyState: {
    padding: "22px 18px",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,.08)",
    background: "rgba(255,255,255,.04)",
    color: "rgba(255,255,255,.72)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(185px, 1fr))",
    gap: 14,
  },
  card: {
    position: "relative",
    borderRadius: 22,
    padding: 14,
    border: "1px solid",
    background:
      "linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04))",
    boxShadow: "0 16px 36px rgba(0,0,0,.28)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    cursor: "pointer",
  },
  rankBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: "50%",
    color: "#000",
    fontSize: 12,
    fontWeight: 900,
    display: "grid",
    placeItems: "center",
  },
  photo: {
    width: "100%",
    height: 110,
    objectFit: "cover",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,.1)",
  },
  cardTop: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  carName: {
    fontSize: 18,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  carDesc: {
    marginTop: 4,
    fontSize: 12,
    color: "rgba(255,255,255,.58)",
    lineHeight: 1.35,
  },
  smallDanger: {
    width: 30,
    height: 30,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.06)",
    color: "#fff",
    cursor: "pointer",
  },
  stats: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  statChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.08)",
    fontSize: 12,
  },
  addCard: {
    borderRadius: 22,
    border: "2px dashed",
    background: "rgba(255,255,255,.03)",
    minHeight: 246,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    color: "#fff",
    cursor: "pointer",
  },
  addCardTitle: {
    fontSize: 18,
    fontWeight: 900,
  },
  addCardText: {
    fontSize: 13,
    color: "rgba(255,255,255,.6)",
    textAlign: "center",
    maxWidth: 140,
  },
  primaryButton: {
    border: "none",
    borderRadius: 16,
    padding: "13px 18px",
    color: "#120F0A",
    fontWeight: 900,
    background: "linear-gradient(90deg, #FFE15A, #FF9D2E)",
    boxShadow: "0 12px 30px rgba(255,181,72,.22)",
    cursor: "pointer",
  },
  ghostButton: {
    border: "1px solid rgba(255,255,255,.1)",
    borderRadius: 16,
    padding: "13px 16px",
    color: "#fff",
    background: "rgba(255,255,255,.05)",
    cursor: "pointer",
  },
  raceButton: {
    marginTop: 6,
    border: "none",
    borderRadius: 20,
    padding: "16px 18px",
    color: "#15110C",
    fontWeight: 900,
    fontSize: 18,
    background: "linear-gradient(90deg, #FFE15A, #FF8A1F)",
    boxShadow: "0 16px 36px rgba(255,148,35,.24)",
  },
  trackWrap: {
    position: "relative",
    borderRadius: 24,
    padding: 14,
    border: "1px solid rgba(255,255,255,.08)",
    background: "rgba(255,255,255,.04)",
  },
  track: {
    position: "relative",
    height: 320,
    overflow: "hidden",
    borderRadius: 18,
    background:
      "linear-gradient(90deg, rgba(255,255,255,.03), rgba(255,255,255,.06)), repeating-linear-gradient(180deg, rgba(255,255,255,.05) 0 1px, transparent 1px 52px)",
  },
  finishLine: {
    position: "absolute",
    right: 18,
    top: 16,
    zIndex: 5,
    fontSize: 14,
    fontWeight: 900,
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,.12)",
    border: "1px solid rgba(255,255,255,.14)",
  },
  racer: {
    position: "absolute",
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    transition: "left .02s linear",
  },
  racerLabel: {
    fontSize: 10,
    fontWeight: 900,
    textShadow: "0 1px 4px rgba(0,0,0,.9)",
    whiteSpace: "nowrap",
  },
  laneBoard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  laneRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  laneName: {
    width: 108,
    fontSize: 12,
    fontWeight: 800,
    textAlign: "right",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  laneBar: {
    flex: 1,
    height: 11,
    borderRadius: 999,
    overflow: "hidden",
    background: "rgba(255,255,255,.08)",
  },
  laneFill: {
    height: "100%",
    borderRadius: 999,
  },
  lanePct: {
    width: 34,
    fontSize: 11,
    color: "rgba(255,255,255,.58)",
    textAlign: "right",
  },
  podiumCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  resultRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 18,
    background: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.08)",
  },
  medal: {
    width: 38,
    textAlign: "center",
    fontSize: 24,
    flexShrink: 0,
  },
  resultName: {
    fontSize: 20,
    fontWeight: 900,
  },
  resultMeta: {
    fontSize: 12,
    color: "rgba(255,255,255,.62)",
    marginTop: 3,
  },
  thumb: {
    width: 54,
    height: 38,
    objectFit: "cover",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,.12)",
  },
  winBanner: {
    padding: "14px 16px",
    borderRadius: 18,
    textAlign: "center",
    fontWeight: 900,
    background: "linear-gradient(90deg, rgba(255,225,90,.16), rgba(255,138,31,.16))",
    border: "1px solid rgba(255,255,255,.08)",
  },
  resultActions: {
    display: "flex",
    gap: 10,
  },
  previewLayer: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "rgba(0,0,0,.6)",
    display: "grid",
    placeItems: "center",
    padding: 16,
  },
  previewCard: {
    width: "min(92vw, 460px)",
    borderRadius: 22,
    overflow: "hidden",
    background: "#0C0C11",
    border: "1px solid rgba(255,255,255,.08)",
    boxShadow: "0 20px 60px rgba(0,0,0,.45)",
  },
  previewImage: {
    width: "100%",
    display: "block",
    maxHeight: 360,
    objectFit: "cover",
  },
  previewText: {
    padding: "14px 16px 10px",
    fontWeight: 700,
    color: "rgba(255,255,255,.88)",
  },
  progress: {
    height: 4,
    margin: "0 16px 16px",
    borderRadius: 999,
    background:
      "linear-gradient(90deg, #FFE15A, #FF8A1F, #49A6FF, #FFE15A)",
    backgroundSize: "200% 100%",
    animation: "float 1s linear infinite",
  },
};
