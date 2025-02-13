import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Camera } from "expo-camera";

const CameraView = () => {
  const [hasPermission, setHasPermission] = useState(null);
  const [cameraType, setCameraType] = useState(Camera.Constants.Type.back);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  if (hasPermission === null) return <View />;
  if (hasPermission === false) return <Text>No access to camera</Text>;

  return (
    <View style={styles.container}>
      <Camera style={styles.camera} type={cameraType} />
      <TouchableOpacity
        style={styles.captureButton}
        onPress={() => console.log("📷 Capturing Image")}
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
  buttonText: { color: "#fff", fontWeight: "bold", fontSize: 18 },
});

export default CameraView;
