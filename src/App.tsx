import React, { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import { Camera, Map as MapIcon, AlertTriangle, CheckCircle, Upload, Info, BarChart3, Navigation, Download, RefreshCw, Send, LogOut, User, TrendingUp, Clock, Lock, Shield, Mail } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import L from "leaflet";
import { detectRoadDefects, DetectionResult } from "./lib/gemini";
import { analyzeImage, AnalysisResult } from "./services/imageAnalysis";
import Auth from "./components/Auth";

// Fix Leaflet icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

interface DetectionRecord extends DetectionResult {
  id: number;
  lat: number;
  lon: number;
  timestamp: string;
  image_path: string;
  traffic_volume: number;
  priority_score: number;
  status: string;
  admin_comment: string;
  is_escalated: number;
}

const SEVERITY_WEIGHTS = {
  Low: 1,
  Medium: 2,
  High: 3
};

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [view, setView] = useState<"citizen" | "municipal" | "profile">("citizen");
  const [detections, setDetections] = useState<DetectionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [lastSubmission, setLastSubmission] = useState<any>(null);
  const [pendingReview, setPendingReview] = useState<{
    file: File;
    previewUrl: string;
    aiResult: DetectionResult;
    analysis: AnalysisResult;
  } | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number]>([51.505, -0.09]);

  useEffect(() => {
    checkAuth();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setUserLocation([pos.coords.latitude, pos.coords.longitude]);
      });
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchDetections();
    }
  }, [user]);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (err) {
      console.error("Auth check failed");
    } finally {
      setAuthChecking(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  };

  const fetchDetections = async () => {
    try {
      const res = await fetch("/api/detections");
      if (res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          setDetections(data);
        } else {
          const text = await res.text();
          console.error("Expected JSON but received:", text.substring(0, 100));
          throw new Error("Server returned HTML instead of JSON. This usually happens when the API route is not found or the user is not authenticated.");
        }
      } else {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        console.error("Failed to fetch detections:", errorData.error);
      }
    } catch (err: any) {
      console.error("Failed to fetch detections", err);
    }
  };

  const processFile = async (file: File) => {
    setLoading(true);
    setUploadStatus("Performing fast on-device analysis...");

    try {
      // 1. Fast On-Device Analysis (TF.js + Canvas)
      const analysis = await analyzeImage(file);
      
      setUploadStatus("Analyzing road defects with Gemini AI...");
      
      // 2. Deep Analysis (Gemini)
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const aiResult = await detectRoadDefects(base64);
        
        setPendingReview({
          file,
          previewUrl: reader.result as string,
          aiResult,
          analysis
        });
        setLoading(false);
        setUploadStatus(null);
      };
    } catch (err) {
      console.error(err);
      setUploadStatus("Error processing image.");
      setLoading(false);
    }
  };

  const submitComplaint = async (editedResult: DetectionResult) => {
    if (!pendingReview) return;
    
    setLoading(true);
    setUploadStatus("Submitting official report...");

    try {
      const trafficVolume = Math.floor(Math.random() * 1000);
      const priorityScore = SEVERITY_WEIGHTS[editedResult.severity] * trafficVolume;

      const formData = new FormData();
      formData.append("image", pendingReview.file);
      formData.append("lat", userLocation[0].toString());
      formData.append("lon", userLocation[1].toString());
      formData.append("timestamp", new Date().toISOString());
      formData.append("severity", editedResult.severity);
      formData.append("class", editedResult.class);
      formData.append("traffic_volume", trafficVolume.toString());
      formData.append("priority_score", priorityScore.toString());
      formData.append("description", editedResult.description);

      const res = await fetch("/api/detections", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setLastSubmission({
          id: data.id,
          timestamp: new Date().toISOString(),
          image: pendingReview.previewUrl,
          class: editedResult.class
        });
        setPendingReview(null);
        fetchDetections();
      } else {
        setUploadStatus("Failed to submit report.");
      }
    } catch (err) {
      console.error(err);
      setUploadStatus("Error submitting report.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-red-600" />
      </div>
    );
  }

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Tricolor Top Bar */}
      <div className="h-1.5 flex">
        <div className="flex-1 bg-saffron"></div>
        <div className="flex-1 bg-white"></div>
        <div className="flex-1 bg-green-india"></div>
      </div>

      <header className="gov-header px-6 py-4 flex flex-col md:flex-row justify-between items-center sticky top-0 z-50 gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-navy-india rounded-full flex items-center justify-center p-1 shadow-inner">
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Ashoka_Chakra.svg/1200px-Ashoka_Chakra.svg.png" 
              alt="Ashoka Chakra" 
              className="w-full h-full invert brightness-0"
            />
          </div>
          <div>
            <h1 className="text-xl font-serif font-bold text-navy-india leading-tight">RoadSense AI</h1>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Government of India • Citizen Portal</p>
          </div>
        </div>
        
        <nav className="flex bg-gray-100 p-1 rounded-full">
          <button 
            onClick={() => setView("citizen")}
            className={`px-6 py-1.5 rounded-full text-sm font-bold transition-all ${view === "citizen" ? "bg-saffron text-white shadow-md" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Lodge Complaint
          </button>
          <button 
            onClick={() => setView("municipal")}
            className={`px-6 py-1.5 rounded-full text-sm font-bold transition-all ${view === "municipal" ? "bg-green-india text-white shadow-md" : "text-slate-600 hover:bg-slate-50"}`}
          >
            Official Dashboard
          </button>
        </nav>

        <div className="flex items-center gap-4">
          {user?.bypass && (
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded text-[10px] font-bold text-amber-700 uppercase tracking-wider animate-pulse">
              <Info className="w-3 h-3" />
              Dev Mode Active
            </div>
          )}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setView("profile")}
              className={`flex flex-col items-end hidden sm:flex hover:opacity-80 transition-opacity ${view === "profile" ? "text-navy-india" : "text-slate-700"}`}
            >
              <span className="text-xs font-bold truncate max-w-[150px]">{user.email}</span>
              <span className="text-[9px] text-slate-400 font-mono">ID: {user.id}</span>
            </button>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setView("profile")}
                className={`p-2 rounded-full transition-all ${view === "profile" ? "bg-navy-india text-white" : "text-slate-400 hover:bg-slate-50 hover:text-navy-india"}`}
                title="Profile Settings"
              >
                <User className="w-5 h-5" />
              </button>
              <button 
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col md:flex-row">
        {view === "citizen" ? (
          <CitizenPortal 
            onUpload={handleFileUpload} 
            onCapture={processFile}
            loading={loading} 
            status={uploadStatus} 
            location={userLocation}
            lastSubmission={lastSubmission}
            pendingReview={pendingReview}
            onReset={() => { setLastSubmission(null); setPendingReview(null); }}
            onTrack={() => setView("municipal")}
            onSubmitReview={submitComplaint}
          />
        ) : view === "municipal" ? (
          <MunicipalDashboard detections={detections} onUpdateStatus={fetchDetections} />
        ) : (
          <UserProfile user={user} />
        )}
      </main>
    </div>
  );
}

function Loader2({ className }: { className?: string }) {
  return <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className={className}><RefreshCw className="w-full h-full" /></motion.div>;
}

function CitizenPortal({ onUpload, onCapture, loading, status, location, lastSubmission, pendingReview, onReset, onTrack, onSubmitReview }: any) {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [capturedImage, setCapturedImage] = useState<{ blob: Blob, url: string } | null>(null);
  const [editedResult, setEditedResult] = useState<DetectionResult | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (pendingReview) {
      setEditedResult(pendingReview.aiResult);
    }
  }, [pendingReview]);

  const startCamera = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        } 
      });

      // Attempt to enable continuous auto-focus if supported
      const track = stream.getVideoTracks()[0];
      const capabilities = (track as any).getCapabilities?.() || {};
      
      if (capabilities.focusMode && capabilities.focusMode.includes("continuous")) {
        try {
          await track.applyConstraints({
            advanced: [{ focusMode: "continuous" }] as any
          });
          console.log("Continuous auto-focus enabled");
        } catch (focusErr) {
          console.warn("Could not set focus mode:", focusErr);
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsCameraOpen(true);
        setCapturedImage(null);
      }
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      const isPermissionError = err.name === "NotAllowedError" || err.message.includes("Permission");
      const msg = isPermissionError
        ? "Camera permission denied or dismissed. This app is running in an iframe, which may block camera access."
        : "Could not access camera: " + err.message;
      
      if (isPermissionError) {
        if (confirm(`${msg}\n\nWould you like to open the app in a new tab to enable camera access?`)) {
          window.open(window.location.href, "_blank");
        }
      } else {
        alert(msg);
      }
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            setCapturedImage({ blob, url });
            stopCamera();
          }
        }, "image/jpeg");
      }
    }
  };

  const handleDownload = () => {
    if (capturedImage) {
      const link = document.createElement("a");
      link.href = capturedImage.url;
      link.download = `roadsense-report-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleSubmit = () => {
    if (capturedImage) {
      const file = new File([capturedImage.blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      onCapture(file);
      setCapturedImage(null);
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
      if (capturedImage) URL.revokeObjectURL(capturedImage.url);
    };
  }, [capturedImage]);

  if (pendingReview && editedResult) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-start max-w-4xl mx-auto space-y-8 pt-12">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4 text-center"
        >
          <h2 className="text-4xl font-serif font-bold text-navy-india tracking-tight">Review Your Complaint</h2>
          <p className="text-slate-600 text-lg">Verify the AI analysis and adjust details if necessary.</p>
        </motion.div>

        <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Image & Quality */}
          <div className="space-y-6">
            <div className="gov-card overflow-hidden">
              <img src={pendingReview.previewUrl} alt="Preview" className="w-full h-auto" />
              <div className="p-6 bg-slate-50 border-t border-slate-200">
                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">On-Device Quality Check (Fast Scan)</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className={`p-3 rounded-lg border flex items-center gap-3 ${pendingReview.analysis.quality.isBlurry ? "bg-red-50 border-red-100 text-red-700" : "bg-green-50 border-green-100 text-green-700"}`}>
                    {pendingReview.analysis.quality.isBlurry ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold">Focus</span>
                      <span className="text-xs font-bold">{pendingReview.analysis.quality.isBlurry ? "Blurry" : "Sharp"}</span>
                    </div>
                  </div>
                  <div className={`p-3 rounded-lg border flex items-center gap-3 ${pendingReview.analysis.quality.isDark ? "bg-red-50 border-red-100 text-red-700" : "bg-green-50 border-green-100 text-green-700"}`}>
                    {pendingReview.analysis.quality.isDark ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase font-bold">Lighting</span>
                      <span className="text-xs font-bold">{pendingReview.analysis.quality.isDark ? "Dark" : "Good"}</span>
                    </div>
                  </div>
                </div>
                
                {pendingReview.analysis.detections.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-200">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2">TF.js Detected Objects</span>
                    <div className="flex flex-wrap gap-2">
                      {pendingReview.analysis.detections.map((d: any, i: number) => (
                        <span key={i} className="bg-navy-india text-white text-[10px] px-2 py-1 rounded font-bold uppercase">
                          {d.class} ({(d.score * 100).toFixed(0)}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Edit Form */}
          <div className="space-y-6">
            <div className="gov-card p-8 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Complaint Category</label>
                  <select 
                    value={editedResult.class}
                    onChange={(e) => setEditedResult({...editedResult, class: e.target.value as any})}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none font-bold text-navy-india"
                  >
                    <option value="Pothole">Pothole</option>
                    <option value="Crack">Crack</option>
                    <option value="Faded Markings">Faded Markings</option>
                    <option value="Debris">Debris</option>
                    <option value="Other">Other / General Maintenance</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Severity Level</label>
                  <div className="flex gap-2">
                    {["Low", "Medium", "High"].map((s) => (
                      <button
                        key={s}
                        onClick={() => setEditedResult({...editedResult, severity: s as any})}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all border ${editedResult.severity === s ? "bg-navy-india text-white border-navy-india" : "bg-white text-slate-400 border-slate-200 hover:bg-slate-50"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Description</label>
                  <textarea 
                    value={editedResult.description}
                    onChange={(e) => setEditedResult({...editedResult, description: e.target.value})}
                    rows={4}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none text-sm text-slate-700"
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={onReset}
                  className="flex-1 px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-lg font-bold text-sm hover:bg-slate-50 transition-all"
                >
                  Discard
                </button>
                <button 
                  onClick={() => onSubmitReview(editedResult)}
                  className="flex-[2] gov-btn-secondary flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Confirm & Submit
                </button>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-3">
              <Info className="w-5 h-5 text-amber-600 shrink-0" />
              <p className="text-[10px] text-amber-800 leading-relaxed">
                <strong>Official Disclaimer:</strong> Providing false information or misrepresenting road conditions is a punishable offense under the Municipal Act. Please ensure all details are accurate before submission.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (lastSubmission) {
    return (
      <div className="flex-1 p-6 flex flex-col items-center justify-center max-w-4xl mx-auto space-y-8">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg gov-card overflow-hidden"
        >
          <div className="bg-green-india p-8 flex flex-col items-center text-white text-center space-y-4">
            <div className="bg-white/20 p-4 rounded-full backdrop-blur-sm">
              <CheckCircle className="w-16 h-16" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-serif font-bold">Complaint Registered Successfully</h3>
              <p className="text-white/80 text-sm font-medium">Photo uploaded successfully ✓</p>
            </div>
          </div>

          <div className="p-8 space-y-6">
            <div className="flex gap-6 items-start">
              <div className="w-24 h-24 bg-slate-100 rounded-lg overflow-hidden border-2 border-slate-100 shadow-inner flex-shrink-0">
                <img src={lastSubmission.image} alt="Submission" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Complaint ID</span>
                  <p className="text-sm font-mono font-bold text-navy-india">#GOI-RS-{lastSubmission.id}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Lodged On</span>
                  <p className="text-xs font-bold text-slate-700">{new Date(lastSubmission.timestamp).toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Classification</span>
                  <p className="text-xs font-bold text-navy-india uppercase tracking-wider">{lastSubmission.class}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button 
                onClick={onTrack}
                className="gov-btn-secondary flex items-center justify-center gap-2 py-3"
              >
                <BarChart3 className="w-4 h-4" />
                Track Complaint
              </button>
              <button 
                onClick={onReset}
                className="gov-btn-primary flex items-center justify-center gap-2 py-3"
              >
                <RefreshCw className="w-4 h-4" />
                Submit Another
              </button>
            </div>
          </div>

          <div className="bg-slate-50 px-8 py-4 border-t border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            A confirmation has been sent to your registered email
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 flex flex-col items-center justify-start max-w-4xl mx-auto space-y-8 pt-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 text-center"
      >
        <h2 className="text-4xl font-serif font-bold text-navy-india tracking-tight">Public Grievance Redressal System</h2>
        <p className="text-slate-600 text-lg max-w-2xl mx-auto">
          Lodge your road-related complaints directly with the municipal authorities. 
          Our AI-powered system ensures rapid classification and priority-based resolution.
        </p>
      </motion.div>

      <div className="w-full max-w-2xl gov-card">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">New Complaint Registration</span>
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-saffron"></div>
            <div className="w-2 h-2 rounded-full bg-slate-300"></div>
            <div className="w-2 h-2 rounded-full bg-green-india"></div>
          </div>
        </div>
        
        <div className="p-8 flex flex-col items-center space-y-6">
          {loading ? (
            <div className="flex flex-col items-center space-y-4 py-12">
              <div className="w-12 h-12 border-4 border-saffron border-t-transparent rounded-full animate-spin"></div>
              <p className="font-bold text-navy-india animate-pulse uppercase tracking-widest text-xs">{status}</p>
            </div>
          ) : capturedImage ? (
            <div className="w-full space-y-6">
              <div className="relative w-full rounded-xl overflow-hidden border-4 border-slate-100 shadow-inner bg-slate-50">
                <img src={capturedImage.url} alt="Captured" className="w-full h-auto max-h-[400px] object-contain" />
                <div className="absolute top-4 right-4 bg-navy-india/80 text-white text-[10px] px-2 py-1 rounded font-mono backdrop-blur-sm">
                  LAT: {location[0].toFixed(4)} | LON: {location[1].toFixed(4)}
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row justify-center gap-3">
                <button 
                  onClick={handleDownload}
                  className="flex-1 bg-white text-slate-700 border border-slate-200 px-6 py-3 rounded-lg font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                >
                  <Download className="w-4 h-4" />
                  Save Copy
                </button>
                <button 
                  onClick={handleSubmit}
                  className="flex-1 gov-btn-secondary flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Lodge Complaint
                </button>
                <button 
                  onClick={startCamera}
                  className="bg-slate-800 text-white p-3 rounded-lg hover:bg-slate-900 transition-all shadow-sm"
                  title="Retake Photo"
                >
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
            </div>
          ) : isCameraOpen ? (
            <div className="w-full space-y-6">
              <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border-4 border-slate-800 shadow-2xl">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 border-[40px] border-black/20 pointer-events-none"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 border-2 border-white/30 rounded-full pointer-events-none"></div>
                
                <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
                  <button 
                    onClick={capturePhoto}
                    className="bg-white text-navy-india p-5 rounded-full shadow-2xl hover:scale-110 transition-all active:scale-95 border-8 border-navy-india/20"
                  >
                    <Camera className="w-8 h-8" />
                  </button>
                  <button 
                    onClick={stopCamera}
                    className="bg-red-600 text-white px-6 py-2 rounded-full shadow-lg hover:bg-red-700 transition-all text-xs font-bold self-center"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <p className="text-center text-xs font-bold text-slate-400 uppercase tracking-widest">Align the defect within the center frame</p>
            </div>
          ) : (
            <div className="w-full py-12 flex flex-col items-center space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-md">
                <button 
                  onClick={startCamera}
                  className="flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-slate-100 hover:border-saffron hover:bg-saffron/5 transition-all group"
                >
                  <div className="bg-saffron/10 p-5 rounded-full group-hover:bg-saffron/20 transition-colors">
                    <Camera className="w-10 h-10 text-saffron" />
                  </div>
                  <span className="font-bold text-navy-india">Capture Photo</span>
                </button>
                
                <div className="flex flex-col items-center gap-4 p-8 rounded-2xl border-2 border-slate-100 hover:border-green-india hover:bg-green-india/5 transition-all group relative">
                  <div className="bg-green-india/10 p-5 rounded-full group-hover:bg-green-india/20 transition-colors">
                    <Upload className="w-10 h-10 text-green-india" />
                  </div>
                  <span className="font-bold text-navy-india">Upload Image</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={onUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
              </div>
              
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Official Mobile Application</p>
                <div className="flex gap-4 opacity-30 grayscale">
                  <div className="w-24 h-8 bg-black rounded"></div>
                  <div className="w-24 h-8 bg-black rounded"></div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="bg-slate-50 px-8 py-4 border-t border-slate-200 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <Info className="w-3 h-3" />
            <span>Digital India Initiative</span>
          </div>
          <span>v2.4.0-RELEASE</span>
        </div>
      </div>

      {status && !loading && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-green-india text-white px-8 py-4 rounded-xl flex items-center gap-3 shadow-xl"
        >
          <CheckCircle className="w-6 h-6" />
          <span className="font-bold uppercase tracking-widest text-sm">{status}</span>
        </motion.div>
      )}

      <div className="flex items-center gap-4 text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-6 py-3 rounded-full shadow-sm">
        <Navigation className="w-4 h-4 text-navy-india" />
        <span className="tracking-widest">GEO-LOCATION: {location[0].toFixed(6)} N, {location[1].toFixed(6)} E</span>
      </div>
    </div>
  );
}

function MunicipalDashboard({ detections, onUpdateStatus }: { detections: DetectionRecord[], onUpdateStatus: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [escalating, setEscalating] = useState<number | null>(null);
  const selectedDetection = detections.find(d => d.id === selectedId);

  const SLA_THRESHOLD_DAYS = 7;
  const SLA_THRESHOLD_MS = SLA_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  const getSLAStatus = (timestamp: string, status: string) => {
    if (status === "Completed" || status === "Rejected") return { isOverdue: false, daysElapsed: 0 };
    
    const elapsed = Date.now() - new Date(timestamp).getTime();
    const daysElapsed = Math.floor(elapsed / (1000 * 60 * 60 * 24));
    return {
      isOverdue: elapsed > SLA_THRESHOLD_MS,
      daysElapsed
    };
  };

  const handleEscalate = async (id: number) => {
    setEscalating(id);
    try {
      const res = await fetch(`/api/detections/${id}/escalate`, { method: "PATCH" });
      if (res.ok) {
        onUpdateStatus();
      }
    } catch (err) {
      console.error("Escalation failed", err);
    } finally {
      setEscalating(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden">
      {/* Sidebar: Work Orders */}
      <div className="w-full md:w-96 border-r border-slate-200 bg-white flex flex-col h-full shadow-lg z-10">
        <div className="p-6 border-b-2 border-green-india bg-slate-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-serif font-bold text-navy-india flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Grievance Queue
            </h3>
            <span className="bg-navy-india text-white text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-widest">
              {detections.length} Total
            </span>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Priority Ranking: AI-Driven</p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {detections.map((d, index) => {
            const sla = getSLAStatus(d.timestamp, d.status);
            return (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={`w-full text-left p-6 hover:bg-slate-50 transition-all flex gap-4 relative group ${selectedId === d.id ? "bg-saffron/5" : ""} ${sla.isOverdue ? "bg-red-50/30" : ""}`}
              >
                {selectedId === d.id && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-saffron"></div>}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">#GOI-{d.id}</span>
                      {sla.isOverdue && (
                        <span className="flex items-center gap-1 text-[9px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                          <Clock className="w-2.5 h-2.5" />
                          SLA OVERDUE
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {d.is_escalated === 1 && <span className="bg-red-600 text-white text-[9px] px-2 py-0.5 rounded font-bold animate-pulse">URGENT</span>}
                      <StatusBadge status={d.status} />
                    </div>
                  </div>
                  <h4 className="font-bold text-navy-india text-sm capitalize truncate group-hover:text-saffron transition-colors">{d.class} Reported</h4>
                  <p className="text-xs text-slate-500 truncate mb-3">{d.description}</p>
                  <div className="flex items-center justify-between">
                    <SeverityBadge severity={d.severity} />
                    <span className="text-[10px] font-bold text-navy-india">PRIORITY: {d.priority_score.toFixed(0)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content: Map & Details */}
      <div className="flex-1 relative flex flex-col">
        <div className="flex-1">
          <MapContainer center={[51.505, -0.09]} zoom={13} className="h-full w-full">
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {detections.map(d => (
              <Marker key={d.id} position={[d.lat, d.lon]}>
                <Popup>
                  <div className="p-1">
                    <h5 className="font-bold capitalize">{d.class}</h5>
                    <p className="text-xs mb-2">{d.description}</p>
                    <div className="flex gap-1">
                      {d.is_escalated === 1 && <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">URGENT</span>}
                      <StatusBadge status={d.status} />
                      <SeverityBadge severity={d.severity} />
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
            <MapUpdater center={selectedDetection ? [selectedDetection.lat, selectedDetection.lon] : null} />
          </MapContainer>
        </div>

        {/* Detail Panel (Overlay) */}
        <AnimatePresence>
          {selectedDetection && (
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="absolute bottom-6 left-6 right-6 gov-card z-[1000] flex flex-col md:flex-row gap-8 p-8 max-h-[85%] overflow-y-auto"
            >
              <div className="w-full md:w-64 h-64 bg-slate-50 rounded-xl overflow-hidden flex-shrink-0 border-4 border-slate-100 shadow-inner">
                <img 
                  src={selectedDetection.image_path} 
                  alt="Detection" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
              <div className="flex-1 space-y-6">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-[10px] font-bold text-saffron uppercase tracking-[0.2em]">Official Case File</span>
                      <span className="text-[10px] font-bold text-slate-300">|</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">#{selectedDetection.id}</span>
                      {getSLAStatus(selectedDetection.timestamp, selectedDetection.status).isOverdue && (
                        <span className="flex items-center gap-1.5 text-[9px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded uppercase tracking-wider">
                          <Clock className="w-3 h-3" />
                          SLA Breach: {getSLAStatus(selectedDetection.timestamp, selectedDetection.status).daysElapsed} Days Overdue
                        </span>
                      )}
                    </div>
                    <h3 className="text-3xl font-serif font-bold text-navy-india capitalize flex items-center gap-4">
                      {selectedDetection.class}
                      {selectedDetection.is_escalated === 1 && (
                        <span className="bg-red-600 text-white text-[10px] px-4 py-1 rounded-full font-bold animate-pulse shadow-lg shadow-red-200">
                          URGENT ESCALATION
                        </span>
                      )}
                    </h3>
                    <p className="text-slate-500 mt-2 leading-relaxed">{selectedDetection.description}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedId(null)} 
                    className="p-2 text-slate-300 hover:text-navy-india hover:bg-slate-50 rounded-full transition-all"
                  >
                    <CheckCircle className="w-8 h-8" />
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <DetailItem label="Severity" value={selectedDetection.severity} />
                  <DetailItem label="Traffic Vol." value={`${selectedDetection.traffic_volume} v/h`} />
                  <DetailItem label="Priority Score" value={selectedDetection.priority_score.toFixed(0)} />
                  <DetailItem label="Current Status" value={selectedDetection.status} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-slate-100">
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Tracking Timeline</h4>
                    <StatusTimeline currentStatus={selectedDetection.status} />
                  </div>
                  
                  <div className="space-y-4">
                    {selectedDetection.admin_comment && (
                      <div className="p-4 bg-navy-india/5 border border-navy-india/10 rounded-xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1 h-full bg-navy-india"></div>
                        <h4 className="text-[10px] font-bold text-navy-india uppercase tracking-widest mb-2">Official Remarks</h4>
                        <p className="text-sm text-slate-700 italic leading-relaxed">"{selectedDetection.admin_comment}"</p>
                      </div>
                    )}
                    
                    <div className="pt-2">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Update Official Status</h4>
                      <StatusUpdateForm 
                        detectionId={selectedDetection.id} 
                        currentStatus={selectedDetection.status}
                        onSuccess={() => {
                          onUpdateStatus();
                          setSelectedId(null);
                        }}
                      />
                    </div>
                  </div>
                </div>

                {selectedDetection.is_escalated === 0 && (
                  <div className="pt-6 border-t border-slate-100">
                    <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-red-100 p-2 rounded-full">
                          <AlertTriangle className="w-5 h-5 text-red-600" />
                        </div>
                        <div>
                          <h4 className="text-sm font-bold text-red-900">Escalate for Urgent Review</h4>
                          <p className="text-xs text-red-700">Flag this report for immediate supervisor intervention.</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleEscalate(selectedDetection.id)}
                        disabled={escalating === selectedDetection.id}
                        className="bg-red-600 text-white px-6 py-2 rounded-lg font-bold text-xs hover:bg-red-700 transition-all disabled:opacity-50 shadow-md"
                      >
                        {escalating === selectedDetection.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Escalate Now"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatusUpdateForm({ detectionId, currentStatus, onSuccess }: { detectionId: number, currentStatus: string, onSuccess: () => void }) {
  const [status, setStatus] = useState(currentStatus);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/detections/${detectionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, comment }),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update status");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Action Status</label>
          <select 
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none text-sm font-medium"
          >
            <option value="Pending">Pending Review</option>
            <option value="In Progress">Under Maintenance</option>
            <option value="Scheduled">Scheduled for Repair</option>
            <option value="Completed">Resolved / Fixed</option>
            <option value="Rejected">Invalid / Rejected</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Complaint ID</label>
          <input 
            type="text" 
            readOnly 
            value={`#GOI-RS-${detectionId}`} 
            className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-500 font-mono outline-none"
          />
        </div>
      </div>
      
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Official Remarks</label>
        <textarea 
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Enter detailed remarks for the resolution process..."
          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none text-sm min-h-[80px]"
        />
      </div>

      {error && <p className="text-red-500 text-xs italic font-bold">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="gov-btn-primary flex items-center gap-2 disabled:opacity-50 text-sm w-full sm:w-auto"
      >
        {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
        Update Official Status
      </button>
    </form>
  );
}

function StatusTimeline({ currentStatus }: { currentStatus: string }) {
  const steps = [
    { id: "Pending", label: "Complaint Lodged", desc: "Citizen reported road defect" },
    { id: "In Progress", label: "Under Review", desc: "Municipal team assessing severity" },
    { id: "Scheduled", label: "Work Scheduled", desc: "Maintenance crew assigned" },
    { id: "Completed", label: "Resolved", desc: "Repair work completed" }
  ];

  const currentIndex = steps.findIndex(s => s.id === currentStatus);
  const actualIndex = currentIndex === -1 ? 0 : currentIndex;

  return (
    <div className="py-4">
      {steps.map((step, idx) => {
        const isCompleted = idx < actualIndex || currentStatus === "Completed";
        const isCurrent = idx === actualIndex && currentStatus !== "Completed";
        
        return (
          <div key={step.id} className="timeline-step">
            <div className={`timeline-dot ${isCompleted ? "bg-green-india" : isCurrent ? "bg-saffron animate-pulse" : "bg-slate-200"}`}>
              {isCompleted && <CheckCircle className="w-full h-full p-1 text-white" />}
            </div>
            <div className="flex flex-col">
              <span className={`text-xs font-bold uppercase tracking-widest ${isCurrent ? "text-saffron" : isCompleted ? "text-green-india" : "text-slate-400"}`}>
                {step.label}
              </span>
              <span className="text-[10px] text-slate-500">{step.desc}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    "Pending": "bg-slate-100 text-slate-600",
    "In Progress": "bg-blue-50 text-blue-700 border border-blue-100",
    "Scheduled": "bg-purple-50 text-purple-700 border border-purple-100",
    "Completed": "bg-green-50 text-green-india border border-green-100",
    "Rejected": "bg-red-50 text-red-700 border border-red-100"
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-widest ${colors[status] || colors["Pending"]}`}>
      {status}
    </span>
  );
}

function MapUpdater({ center }: { center: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, 16);
    }
  }, [center, map]);
  return null;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = {
    Low: "bg-blue-100 text-blue-700",
    Medium: "bg-orange-100 text-orange-700",
    High: "bg-red-100 text-red-700"
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${colors[severity as keyof typeof colors]}`}>
      {severity}
    </span>
  );
}

function DetailItem({ label, value }: { label: string, value: string }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
      <p className="text-sm font-bold text-navy-india">{value}</p>
    </div>
  );
}

function UserProfile({ user }: { user: any }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error", text: string } | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "New passwords do not match" });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "New password must be at least 6 characters" });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Password updated successfully" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update password" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 p-6 flex flex-col items-center justify-start max-w-4xl mx-auto space-y-8 pt-12">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 text-center"
      >
        <h2 className="text-4xl font-serif font-bold text-navy-india tracking-tight">Account Settings</h2>
        <p className="text-slate-600 text-lg">Manage your digital identity and security preferences.</p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full">
        {/* Profile Info */}
        <div className="md:col-span-1 space-y-6">
          <div className="gov-card p-6 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-4 border-4 border-white shadow-md">
              <User className="w-12 h-12 text-navy-india" />
            </div>
            <h3 className="font-bold text-navy-india truncate w-full px-2">{user.email}</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Citizen Account</p>
            
            <div className="w-full mt-6 pt-6 border-t border-slate-100 space-y-4 text-left">
              <div className="flex items-center gap-3 text-slate-600">
                <Mail className="w-4 h-4" />
                <span className="text-xs font-medium">{user.email}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-600">
                <Shield className="w-4 h-4" />
                <span className="text-xs font-medium">Verified Citizen</span>
              </div>
            </div>
          </div>

          <div className="bg-navy-india text-white p-6 rounded-xl shadow-lg relative overflow-hidden">
            <div className="absolute -right-4 -bottom-4 opacity-10">
              <Shield className="w-24 h-24" />
            </div>
            <h4 className="font-bold text-sm mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Privacy Notice
            </h4>
            <p className="text-[10px] leading-relaxed opacity-80">
              Your data is protected under the Digital Personal Data Protection Act. 
              We never share your personal information with third parties.
            </p>
          </div>
        </div>

        {/* Security Settings */}
        <div className="md:col-span-2 space-y-6">
          <div className="gov-card">
            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex items-center gap-3">
              <Lock className="w-5 h-5 text-navy-india" />
              <h3 className="font-bold text-navy-india uppercase tracking-widest text-xs">Security & Password</h3>
            </div>
            
            <div className="p-8">
              {user.bypass ? (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex items-center gap-3 text-amber-800">
                  <Info className="w-5 h-5" />
                  <p className="text-sm font-medium">Security settings are disabled in developer bypass mode.</p>
                </div>
              ) : (
                <form onSubmit={handlePasswordChange} className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Current Password</label>
                      <input 
                        type="password"
                        required
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">New Password</label>
                        <input 
                          type="password"
                          required
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none transition-all"
                          placeholder="••••••••"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Confirm New Password</label>
                        <input 
                          type="password"
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-saffron outline-none transition-all"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>

                  {message && (
                    <div className={`p-4 rounded-lg flex items-center gap-3 text-sm font-medium ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-100" : "bg-red-50 text-red-700 border border-red-100"}`}>
                      {message.type === "success" ? <CheckCircle className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                      {message.text}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button 
                      type="submit"
                      disabled={loading}
                      className="gov-btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                      Update Security Credentials
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          <div className="gov-card p-8 bg-slate-50 border-dashed border-2 border-slate-200">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="space-y-1 text-center sm:text-left">
                <h4 className="font-bold text-navy-india">Two-Factor Authentication</h4>
                <p className="text-xs text-slate-500">Add an extra layer of security to your account.</p>
              </div>
              <button className="px-6 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-400 cursor-not-allowed">
                Coming Soon
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
