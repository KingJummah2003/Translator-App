import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createStackNavigator } from "@react-navigation/stack";
import LoadingScreen from "./src/screens/LoadingScreen";
import HomeScreen from "./src/screens/HomeScreen";
import CameraView from "./src/components/CameraView";

const Stack = createStackNavigator();
const BACKEND_URL = "http://192.168.0.36:5000"; 

const App = () => {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkBackendStatus = async () => {
      try {
        let response = await fetch(`${BACKEND_URL}/status`);
        let data = await response.json();
        console.log("✅ Backend Response:", data);
        if (!data.loading) {
          setIsLoading(false);
        }
      } catch (err) {
        console.error("❌ Backend Error:", err);
      }
    };

    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isLoading ? (
          <Stack.Screen name="Loading" component={LoadingScreen} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="CameraView" component={CameraView} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;
