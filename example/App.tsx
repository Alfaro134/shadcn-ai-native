/**
 * Composition root: the only place that decides which ChatModel the app uses.
 *
 *   src/domain          entities and the ChatModel port        (no React, no I/O)
 *   src/application     use cases: ChatSession + useChat hook  (depends on domain)
 *   src/infrastructure  ChatModel adapters, e.g. simulated     (implements domain ports)
 *   src/ui              screens and rows                       (depends on application)
 *
 * To talk to a real model, write an adapter in src/infrastructure and swap it in below.
 */
import "./global.css";

import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { SimulatedChatModel } from "./src/infrastructure/simulated-chat-model";
import { ChatScreen } from "./src/ui/ChatScreen";

const model = new SimulatedChatModel();

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen model={model} />
    </SafeAreaProvider>
  );
}
