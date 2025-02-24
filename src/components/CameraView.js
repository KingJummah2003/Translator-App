import React, { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Camera, CameraType } from "expo-camera";


const CameraType = {
  back: "back",
  front: "front"
};
const CameraView = () => {
  const [hasPermission, setHasPermission] = useState(null);
  const [cameraType, setCameraType] = useState(CameraType.back);
  const cameraRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  if (hasPermission === null) return <View />;
  if (hasPermission === false) return <Text>No access to camera</Text>;

  return (
    <View style={styles.container}>
      <Camera ref={cameraRef} style={styles.camera} type={cameraType} />
      
      {/* Flip Camera Button */}
      <TouchableOpacity
        style={styles.flipButton}
        onPress={() => setCameraType(cameraType === CameraType.back ? CameraType.front : CameraType.back)}
      >
        <Text style={styles.buttonText}>Flip Camera</Text>
      </TouchableOpacity>

      {/* Capture Button */}
      <TouchableOpacity
        style={styles.captureButton}
        onPress={async () => {
          if (cameraRef.current) {
            const photo = await cameraRef.current.takePictureAsync();
            console.log("📷 Captured Image:", photo.uri);
          }
        }}
      >
        <Text style={styles.buttonText}>Capture</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  captureButton: {
    position: "absolute",
    bottom: 50,
    backgroundColor: "#e74c3c",
    padding: 15,
    borderRadius: 10,
    alignSelf: "center",
  },
  flipButton: {
    position: "absolute",
    bottom: 120,
    backgroundColor: "#3498db",
    padding: 15,
    borderRadius: 10,
    alignSelf: "center",
  },
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 18 },
});

export default CameraView;
