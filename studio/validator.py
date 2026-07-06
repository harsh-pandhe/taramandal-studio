"""
Taramandal Studio - Trajectory Safety Validator
"""

import math

def interpolate_waypoint(waypoints: list, t: float) -> dict:
    if not waypoints:
        return None
    if t <= waypoints[0]["time"]:
        return waypoints[0]
    if t >= waypoints[-1]["time"]:
        return waypoints[-1]
        
    for i in range(len(waypoints) - 1):
        w1 = waypoints[i]
        w2 = waypoints[i+1]
        if w1["time"] <= t <= w2["time"]:
            span = w2["time"] - w1["time"]
            ratio = (t - w1["time"]) / span if span > 0 else 0.0
            
            # Simple yaw angle interpolation wrapping
            diff = (w2["yaw"] - w1["yaw"]) % 360
            if diff > 180:
                diff -= 360
            interpolated_yaw = (w1["yaw"] + ratio * diff) % 360
            
            return {
                "time": t,
                "x": w1["x"] + ratio * (w2["x"] - w1["x"]),
                "y": w1["y"] + ratio * (w2["y"] - w1["y"]),
                "z": w1["z"] + ratio * (w2["z"] - w1["z"]),
                "yaw": interpolated_yaw
            }
    return waypoints[-1]

def validate_choreography(
    choreo_data: dict,
    safe_dist_threshold: float = 0.8,
    max_velocity: float = 4.0,
    max_accel: float = 2.0,
    max_yaw_rate: float = 180.0
) -> dict:
    """
    Validates a multi-drone choreography trajectory.
    Sweeps the timeline at 0.1s steps to evaluate proximity, velocity, acceleration, and yaw rates.
    """
    drones = choreo_data.get("drones", [])
    if not drones:
        return {
            "status": "FAILED",
            "summary": "No drones found in choreography.",
            "violations": {"proximity": [], "velocity": [], "acceleration": [], "yaw_rate": []}
        }
        
    # Find max time
    max_time = 0.0
    for d in drones:
        wps = d.get("waypoints", [])
        if wps:
            max_time = max(max_time, wps[-1]["time"])
            
    violations = {
        "proximity": [],
        "velocity": [],
        "acceleration": [],
        "yaw_rate": []
    }
    
    dt = 0.1
    steps = int(round(max_time / dt))
    
    # Store states of previous step to check kinematics
    prev_states = {}  # drone_id -> {"pos": (x,y,z), "vel": (vx,vy,vz), "v": scalar_v, "yaw": yaw}
    
    min_dist_found = float("inf")
    max_vel_found = 0.0
    max_acc_found = 0.0
    max_yaw_rate_found = 0.0
    
    for step in range(steps + 1):
        t = step * dt
        
        # 1. Proximity check
        active_positions = {}
        for d in drones:
            wps = d.get("waypoints", [])
            pos = interpolate_waypoint(wps, t)
            if pos:
                active_positions[d["id"]] = pos
                
        # Compare all pairs
        d_ids = list(active_positions.keys())
        for i in range(len(d_ids)):
            for j in range(i + 1, len(d_ids)):
                id1 = d_ids[i]
                id2 = d_ids[j]
                p1 = active_positions[id1]
                p2 = active_positions[id2]
                
                dist = ((p1["x"] - p2["x"])**2 + (p1["y"] - p2["y"])**2 + (p1["z"] - p2["z"])**2)**0.5
                min_dist_found = min(min_dist_found, dist)
                
                if dist < safe_dist_threshold:
                    violations["proximity"].append({
                        "time": round(t, 2),
                        "drones": [id1, id2],
                        "distance": round(dist, 2)
                    })
                    
        # 2. Kinematics check
        for d_id, curr_wp in active_positions.items():
            if d_id in prev_states:
                prev = prev_states[d_id]
                dx = curr_wp["x"] - prev["pos"][0]
                dy = curr_wp["y"] - prev["pos"][1]
                dz = curr_wp["z"] - prev["pos"][2]
                
                vx = dx / dt
                vy = dy / dt
                vz = dz / dt
                v = (vx**2 + vy**2 + vz**2)**0.5
                max_vel_found = max(max_vel_found, v)
                
                # Accel
                prev_vx, prev_vy, prev_vz = prev["vel"]
                ax = (vx - prev_vx) / dt
                ay = (vy - prev_vy) / dt
                az = (vz - prev_vz) / dt
                a = (ax**2 + ay**2 + az**2)**0.5
                max_acc_found = max(max_acc_found, a)
                
                # Yaw rate
                dyaw = (curr_wp["yaw"] - prev["yaw"]) % 360
                if dyaw > 180:
                    dyaw -= 360
                yaw_rate = abs(dyaw) / dt
                max_yaw_rate_found = max(max_yaw_rate_found, yaw_rate)
                
                # Check limits
                if v > max_velocity:
                    violations["velocity"].append({
                        "time": round(t, 2),
                        "drone": d_id,
                        "velocity": round(v, 2)
                    })
                if a > max_accel:
                    violations["acceleration"].append({
                        "time": round(t, 2),
                        "drone": d_id,
                        "acceleration": round(a, 2)
                    })
                if yaw_rate > max_yaw_rate:
                    violations["yaw_rate"].append({
                        "time": round(t, 2),
                        "drone": d_id,
                        "yaw_rate": round(yaw_rate, 2)
                    })
                    
                prev_states[d_id] = {
                    "pos": (curr_wp["x"], curr_wp["y"], curr_wp["z"]),
                    "vel": (vx, vy, vz),
                    "v": v,
                    "yaw": curr_wp["yaw"]
                }
            else:
                prev_states[d_id] = {
                    "pos": (curr_wp["x"], curr_wp["y"], curr_wp["z"]),
                    "vel": (0.0, 0.0, 0.0),
                    "v": 0.0,
                    "yaw": curr_wp["yaw"]
                }
                
    # Deduplicate violations to keep report readable
    for key in violations:
        # Sort by time
        violations[key] = sorted(violations[key], key=lambda x: x["time"])
        # Cap at 50 to avoid bloating JSON response
        violations[key] = violations[key][:50]
        
    has_violations = any(len(violations[k]) > 0 for k in violations)
    status = "FAILED" if has_violations else "PASSED"
    
    summary_msg = "Choreography passed all safety checks!" if status == "PASSED" else "Choreography failed safety validation checks."
    
    return {
        "status": status,
        "summary": summary_msg,
        "metrics": {
            "min_distance_m": round(min_dist_found, 2) if min_dist_found != float("inf") else 0.0,
            "max_velocity_m_s": round(max_vel_found, 2),
            "max_acceleration_m_s2": round(max_acc_found, 2),
            "max_yaw_rate_deg_s": round(max_yaw_rate_found, 2)
        },
        "violations": violations
    }
