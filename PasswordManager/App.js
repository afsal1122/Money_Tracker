// App.js - CORRECTED VERSION

// Make sure this is the VERY first import in your app
import 'react-native-gesture-handler';

// 1. Import the necessary component
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import React, { useState, useEffect } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import CreateVaultScreen from './screens/CreateVaultScreen';
import UnlockVaultScreen from './screens/UnlockVaultScreen';
import VaultScreen from './screens/VaultScreen';

export default function App() {
  const [appState, setAppState] = useState('loading');
  const [sessionData, setSessionData] = useState(null);

  useEffect(() => {
    const checkVaultExists = async () => {
      const vault = await SecureStore.getItemAsync('user_vault');
      if (vault) {
        setAppState('needs_unlock');
      } else {
        setAppState('needs_creation');
      }
    };
    checkVaultExists();
  }, []);

  const handleVaultCreated = (key, vault) => {
    setSessionData({ key, vault });
    setAppState('unlocked');
  };

  const handleVaultUnlocked = (key, vault) => {
    setSessionData({ key, vault });
    setAppState('unlocked');
  };

  const handleLogout = async () => {
    setSessionData(null);
    await SecureStore.deleteItemAsync('biometric_key');
    setAppState('needs_unlock');
  };

  // Helper function to render the correct screen
  const renderContent = () => {
    if (appState === 'loading') {
      return (
        <View style={styles.container}>
          <ActivityIndicator size="large" />
        </View>
      );
    }
    if (appState === 'needs_creation') {
      return <CreateVaultScreen onVaultCreated={handleVaultCreated} />;
    }
    if (appState === 'needs_unlock') {
      return <UnlockVaultScreen onVaultUnlocked={handleVaultUnlocked} />;
    }
    if (appState === 'unlocked') {
      return <VaultScreen sessionData={sessionData} onLogout={handleLogout} />;
    }
    return null;
  };

  // 2. Wrap the entire app content with GestureHandlerRootView
  //    The style={{ flex: 1 }} is crucial for it to take up the whole screen.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {renderContent()}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});