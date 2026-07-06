import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle, 
  Download, 
  PlusCircle, 
  Compass, 
  Globe, 
  Activity 
} from 'lucide-react';
import './App.css';

const API_BASE = "http://127.0.0.1:8000";

const interpolateWaypoint = (waypoints, t) => {
  if (!waypoints || waypoints.length === 0) return null;
  if (t <= waypoints[0].time) return waypoints[0];
  if (t >= waypoints[waypoints.length - 1].time) return waypoints[waypoints.length - 1];
  
  for (let i = 0; i < waypoints.length - 1; i++) {
    const w1 = waypoints[i];
    const w2 = waypoints[i+1];
    if (w1.time <= t && t <= w2.time) {
      const ratio = (t - w1.time) / (w2.time - w1.time);
      return {
        x: w1.x + ratio * (w2.x - w1.x),
        y: w1.y + ratio * (w2.y - w1.y),
        z: w1.z + ratio * (w2.z - w1.z),
        yaw: w1.yaw + ratio * (w2.yaw - w1.yaw)
      };
    }
  }
  return waypoints[waypoints.length - 1];
};

export default function App() {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const dronesGroupRef = useRef(null);
  const pathsGroupRef = useRef(null);
  const gridHelperRef = useRef(null);
  const instancedMeshRef = useRef(null);
  
  // Input settings
  const [shape, setShape] = useState("circle");
  const [numDrones, setNumDrones] = useState(3);
  const [duration, setDuration] = useState(30.0);
  const [rate, setRate] = useState(2.0);
  const [prompt, setPrompt] = useState("");
  
  // Geography Reference
  const [homeLat, setHomeLat] = useState(12.9716);
  const [homeLon, setHomeLon] = useState(77.5946);
  
  // Data state
  const [choreoData, setChoreoData] = useState(null);
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Playback state
  const [currentTime, setCurrentTime] = useState(0.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  
  // Generate on start
  useEffect(() => {
    handleGenerate();
  }, []);
  
  // 3D Scene setup
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060913);
    
    // Camera
    const camera = new THREE.PerspectiveCamera(
      60, 
      containerRef.current.clientWidth / containerRef.current.clientHeight, 
      0.1, 
      1000
    );
    // Position camera looking down at the flight field
    camera.position.set(10, 15, 20);
    camera.lookAt(5, 0, 5);
    
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;
    
    // Grid Helper representing ground field
    const gridHelper = new THREE.GridHelper(40, 40, 0x38bdf8, 0x1e293b);
    gridHelper.position.set(5, 0, 5);
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);
    
    // Groups for active meshes
    const dronesGroup = new THREE.Group();
    scene.add(dronesGroup);
    dronesGroupRef.current = dronesGroup;
    
    const pathsGroup = new THREE.Group();
    scene.add(pathsGroup);
    pathsGroupRef.current = pathsGroup;
    
    // Draw home origin axes
    const axesHelper = new THREE.AxesHelper(3);
    scene.add(axesHelper);
    
    // Simple drag orbit controls simulated mathematically
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let theta = Math.PI / 4;
    let phi = Math.PI / 3;
    let radius = 25;
    
    const updateCamera = () => {
      camera.position.x = 5 + radius * Math.sin(phi) * Math.sin(theta);
      camera.position.z = 5 + radius * Math.sin(phi) * Math.cos(theta);
      camera.position.y = radius * Math.cos(phi);
      camera.lookAt(5, 1, 5);
    };
    
    updateCamera();
    
    const handleMouseDown = (e) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };
    
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      
      theta -= dx * 0.005;
      phi -= dy * 0.005;
      phi = Math.max(0.1, Math.min(Math.PI / 2.1, phi)); // keep camera above ground
      
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
      updateCamera();
    };
    
    const handleMouseUp = () => {
      isDragging = false;
    };
    
    const handleWheel = (e) => {
      radius += e.deltaY * 0.02;
      radius = Math.max(5, Math.min(100, radius));
      updateCamera();
    };
    
    const container = containerRef.current;
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('wheel', handleWheel);
    
    // Resize Handler
    const handleResize = () => {
      if (!containerRef.current) return;
      camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);
    
    // Render loop
    let animationId;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    
    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      container.removeEventListener('mousedown', handleMouseDown);
      container.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);
  
  // Re-draw static path lines whenever choreoData changes
  useEffect(() => {
    if (!pathsGroupRef.current || !choreoData) return;
    
    // Clear old lines
    while (pathsGroupRef.current.children.length > 0) {
      const obj = pathsGroupRef.current.children[0];
      pathsGroupRef.current.remove(obj);
    }
    
    const colors = [0x38bdf8, 0x10b981, 0xf59e0b, 0xec4899, 0x8b5cf6, 0x3b82f6];
    
    choreoData.drones.forEach((drone, idx) => {
      const color = colors[idx % colors.length];
      const points = [];
      
      drone.waypoints.forEach(wp => {
        // NED: convert negative z height back to positive z for Blender representation
        points.push(new THREE.Vector3(wp.x, -wp.z, wp.y));
      });
      
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ 
        color: color, 
        linewidth: 2,
        transparent: true,
        opacity: 0.6
      });
      const line = new THREE.Line(geometry, material);
      pathsGroupRef.current.add(line);
    });
  }, [choreoData]);
  
  // Re-create InstancedMesh when choreoData changes
  useEffect(() => {
    if (!dronesGroupRef.current || !choreoData) return;
    
    // Clear old objects
    while (dronesGroupRef.current.children.length > 0) {
      dronesGroupRef.current.remove(dronesGroupRef.current.children[0]);
    }
    
    const numDrones = choreoData.drones.length;
    if (numDrones === 0) return;
    
    // Create single geometry and material
    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    const material = new THREE.MeshPhongMaterial({ 
      shininess: 100
    });
    
    const instancedMesh = new THREE.InstancedMesh(geometry, material, numDrones);
    dronesGroupRef.current.add(instancedMesh);
    instancedMeshRef.current = instancedMesh;
    
    // Set individual colors at initialization
    const colors = [0x38bdf8, 0x10b981, 0xf59e0b, 0xec4899, 0x8b5cf6, 0x3b82f6];
    const threeColor = new THREE.Color();
    for (let idx = 0; idx < numDrones; idx++) {
      threeColor.setHex(colors[idx % colors.length]);
      instancedMesh.setColorAt(idx, threeColor);
    }
    instancedMesh.instanceColor.needsUpdate = true;
  }, [choreoData]);
  
  // Update InstancedMesh matrices based on currentTime
  useEffect(() => {
    if (!instancedMeshRef.current || !choreoData) return;
    
    const instancedMesh = instancedMeshRef.current;
    const dummy = new THREE.Object3D();
    
    choreoData.drones.forEach((drone, idx) => {
      const wp = interpolateWaypoint(drone.waypoints, currentTime);
      if (wp) {
        dummy.position.set(wp.x, -wp.z, wp.y);
        
        // Convert yaw angle to Z rotation
        dummy.rotation.y = THREE.MathUtils.degToRad(wp.yaw);
        dummy.updateMatrix();
        
        instancedMesh.setMatrixAt(idx, dummy.matrix);
      }
    });
    
    instancedMesh.instanceMatrix.needsUpdate = true;
  }, [choreoData, currentTime]);
  
  // Playback timer loop
  useEffect(() => {
    if (!isPlaying || !choreoData) return;
    
    let lastTime = performance.now();
    let animId;
    
    const tick = () => {
      const now = performance.now();
      const delta = (now - lastTime) / 1000.0;
      lastTime = now;
      
      setCurrentTime(prev => {
        let next = prev + delta * playbackSpeed;
        if (next >= duration) {
          next = 0.0; // loop
        }
        return next;
      });
      
      animId = requestAnimationFrame(tick);
    };
    
    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, playbackSpeed, choreoData, duration]);
  
  // AI Prompt Shape Mapper
  const parsePromptForShape = (text) => {
    const t = text.toLowerCase();
    if (t.includes("heart")) return "heart";
    if (t.includes("helix") || t.includes("spiral")) return "helix";
    if (t.includes("cube") || t.includes("grid") || t.includes("box")) return "cube";
    if (t.includes("circle") || t.includes("ring")) return "circle";
    return null;
  };
  
  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    
    let chosenShape = shape;
    if (prompt) {
      const parsed = parsePromptForShape(prompt);
      if (parsed) {
        chosenShape = parsed;
        setShape(parsed);
      }
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shape: chosenShape,
          num_drones: Number(numDrones),
          duration: Number(duration),
          rate: Number(rate)
        })
      });
      if (!res.ok) throw new Error("Shape generation failed.");
      
      const data = await res.json();
      setChoreoData(data.choreo);
      setValidation(data.validation);
      setCurrentTime(0.0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  
  const handleExport = async (format) => {
    if (!choreoData) return;
    try {
      const res = await fetch(`${API_BASE}/api/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choreo: choreoData,
          format: format,
          home_lat: Number(homeLat),
          home_lon: Number(homeLon)
        })
      });
      if (!res.ok) throw new Error("File export failed.");
      const data = await res.json();
      
      // Trigger browser download
      const element = document.createElement("a");
      const file = new Blob([data.content], { type: data.mime_type });
      element.href = URL.createObjectURL(file);
      element.download = data.filename;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } catch (e) {
      alert("Error exporting choreography: " + e.message);
    }
  };
  
  return (
    <div className="studio-container">
      {/* Header */}
      <header className="studio-header">
        <div className="brand">
          <div className="brand-icon">
            <span>✨</span>
          </div>
          <div className="brand-title">
            <h1>Taramandal Studio</h1>
            <p>Swarm Choreography Engine</p>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div className="legend-item" style={{ margin: 0 }}>
            <span className="legend-color" style={{ background: '#38bdf8' }}></span>
            <span style={{ fontSize: '0.85rem' }}>Generator Active</span>
          </div>
        </div>
      </header>
      
      {/* Workspace */}
      <div className="studio-workspace">
        {/* Sidebar settings */}
        <aside className="studio-sidebar">
          {/* AI prompt generator */}
          <div className="glass-panel">
            <h2 className="panel-title"><Compass size={16} /> AI Prompt Generation</h2>
            <div className="form-group">
              <label>AI Prompt Description</label>
              <textarea 
                rows="2"
                placeholder="E.g., create a rotating heart shape for 6 drones"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Pattern Shape</label>
                <select value={shape} onChange={(e) => setShape(e.target.value)}>
                  <option value="circle">Rotating Circle</option>
                  <option value="helix">3D Helix</option>
                  <option value="heart">Spinning Heart</option>
                  <option value="cube">Cubic Grid</option>
                </select>
              </div>
              <div className="form-group">
                <label>Drone Count</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={numDrones}
                  onChange={(e) => setNumDrones(Math.max(1, Math.min(10, e.target.value)))}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Duration (s)</label>
                <input 
                  type="number" 
                  min="10" 
                  max="120" 
                  value={duration}
                  onChange={(e) => setDuration(Math.max(10, e.target.value))}
                />
              </div>
              <div className="form-group">
                <label>Rate (Hz)</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  step="0.5"
                  value={rate}
                  onChange={(e) => setRate(Math.max(1, e.target.value))}
                />
              </div>
            </div>
            <button 
              className="btn-primary" 
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? "GENERATING..." : "BUILD Trajectory"}
            </button>
          </div>
          
          {/* Safety Validation Panel */}
          {validation && (
            <div className="glass-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <h2 className="panel-title"><Activity size={16} /> Safety Validation</h2>
              
              <div className={`validation-summary ${validation.status.toLowerCase()}`}>
                {validation.status === "PASSED" ? (
                  <>
                    <CheckCircle size={18} />
                    <span>{validation.summary}</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={18} />
                    <span>{validation.summary}</span>
                  </>
                )}
              </div>
              
              <div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-title">Min Separation</div>
                  <div className={`metric-val ${validation.metrics.min_distance_m >= 0.8 ? 'passed' : 'danger'}`}>
                    {validation.metrics.min_distance_m}m
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">Max Speed</div>
                  <div className={`metric-val ${validation.metrics.max_velocity_m_s <= 4.0 ? 'passed' : 'warning'}`}>
                    {validation.metrics.max_velocity_m_s}m/s
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">Max Accel</div>
                  <div className={`metric-val ${validation.metrics.max_acceleration_m_s2 <= 2.0 ? 'passed' : 'warning'}`}>
                    {validation.metrics.max_acceleration_m_s2}m/s²
                  </div>
                </div>
                <div className="metric-card">
                  <div className="metric-title">Max Yaw Rate</div>
                  <div className={`metric-val ${validation.metrics.max_yaw_rate_deg_s <= 180.0 ? 'passed' : 'warning'}`}>
                    {Math.round(validation.metrics.max_yaw_rate_deg_s)}°/s
                  </div>
                </div>
              </div>
              
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <span className="telemetry-label" style={{ fontSize: '0.7rem', marginBottom: '0.5rem', display: 'block' }}>
                  Safety Violations ({
                    validation.violations.proximity.length + 
                    validation.violations.velocity.length + 
                    validation.violations.acceleration.length
                  })
                </span>
                
                <div className="violations-list">
                  {validation.violations.proximity.map((v, i) => (
                    <div key={`p-${i}`} className="violation-item">
                      <span>⚠️ Proximity breach (D{v.drones[0]} & D{v.drones[1]})</span>
                      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{v.distance}m @ {v.time}s</span>
                    </div>
                  ))}
                  {validation.violations.velocity.map((v, i) => (
                    <div key={`v-${i}`} className="violation-item">
                      <span>⚡ Speed warning (Drone {v.drone})</span>
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{v.velocity}m/s @ {v.time}s</span>
                    </div>
                  ))}
                  {validation.violations.acceleration.map((v, i) => (
                    <div key={`a-${i}`} className="violation-item">
                      <span>📉 Accel warning (Drone {v.drone})</span>
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{v.acceleration}m/s² @ {v.time}s</span>
                    </div>
                  ))}
                  {validation.violations.proximity.length === 0 && 
                   validation.violations.velocity.length === 0 && 
                   validation.violations.acceleration.length === 0 && (
                     <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center', padding: '1rem' }}>
                       Zero failsafe/hazard exceptions raised.
                     </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Exporters Panel */}
          <div className="glass-panel">
            <h2 className="panel-title"><Globe size={16} /> Exporter Settings</h2>
            <div className="form-row">
              <div className="form-group">
                <label>Venue Lat</label>
                <input 
                  type="number" 
                  step="0.0001"
                  value={homeLat}
                  onChange={(e) => setHomeLat(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Venue Lon</label>
                <input 
                  type="number" 
                  step="0.0001"
                  value={homeLon}
                  onChange={(e) => setHomeLon(e.target.value)}
                />
              </div>
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button className="btn-secondary" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', justifyContent: 'center' }} onClick={() => handleExport("json")}>
                <Download size={14} /> JSON
              </button>
              <button className="btn-secondary" style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', justifyContent: 'center' }} onClick={() => handleExport("csv")}>
                <Download size={14} /> CSV
              </button>
            </div>
            <button className="btn-primary" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'center', marginTop: '0.5rem' }} onClick={() => handleExport("kml")}>
              <Globe size={16} /> Export Google Earth KML
            </button>
          </div>
        </aside>
        
        {/* 3D Viewport */}
        <main className="studio-viewport">
          <div ref={containerRef} className="canvas-container">
            {/* Visual Legend */}
            <div className="legend-overlay">
              <div className="legend-item">
                <span className="legend-color" style={{ background: '#38bdf8' }}></span>
                <span>Drone 00 path</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ background: '#10b981' }}></span>
                <span>Drone 01 path</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ background: '#f59e0b' }}></span>
                <span>Drone 02 path</span>
              </div>
            </div>
            
            {/* Loading indicators */}
            {loading && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, background: 'rgba(6,9,19,0.85)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--primary)' }}>
                <span>✨ Synchronizing Swarm Trajectories...</span>
              </div>
            )}
            
            {error && (
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 10, background: 'rgba(239,68,68,0.85)', padding: '1.5rem', borderRadius: '8px', border: '1px solid #ff8888' }}>
                <span>❌ Error: {error}</span>
              </div>
            )}
          </div>
          
          {/* Timeline player panel */}
          {choreoData && (
            <div className="timeline-overlay">
              <div className="timeline-controls">
                <button className="play-btn" onClick={() => setIsPlaying(!isPlaying)}>
                  {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button className="play-btn" style={{ background: 'transparent', border: '1px solid var(--panel-border)', boxShadow: 'none' }} onClick={() => setCurrentTime(0.0)}>
                  <RotateCcw size={18} />
                </button>
                
                <div className="slider-container">
                  <span className="telemetry-label">Timeline</span>
                  <input 
                    type="range"
                    className="timeline-slider"
                    min="0"
                    max={duration}
                    step="0.05"
                    value={currentTime}
                    onChange={(e) => {
                      setCurrentTime(Number(e.target.value));
                      setIsPlaying(false);
                    }}
                  />
                  <div className="time-display">
                    {currentTime.toFixed(2)}s / {duration.toFixed(1)}s
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <button 
                    className="btn-secondary" 
                    style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', width: 'auto', background: playbackSpeed === 1.0 ? 'rgba(56,189,248,0.1)' : 'transparent' }}
                    onClick={() => setPlaybackSpeed(1.0)}
                  >
                    1x
                  </button>
                  <button 
                    className="btn-secondary" 
                    style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', width: 'auto', background: playbackSpeed === 2.0 ? 'rgba(56,189,248,0.1)' : 'transparent' }}
                    onClick={() => setPlaybackSpeed(2.0)}
                  >
                    2x
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
