/**
 * Composition root: the only place that decides which ChatModel the app uses.
 *
 *   src/domain          entities and the ChatModel port        (no React, no I/O)
 *   src/application     use cases: ChatSession + useChat hook  (depends on domain)
 *   src/infrastructure  adapters for the domain ports          (simulated model, telemetry)
 *   src/ui              screens and rows                       (depends on application)
 *
 * To talk to a real model or report to your analytics, write an adapter in src/infrastructure and
 * swap it in below.
 */
import "./global.css";

import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ConsoleTelemetry } from "./src/infrastructure/console-telemetry";
import { SimulatedChatModel } from "./src/infrastructure/simulated-chat-model";
import { ChatScreen } from "./src/ui/ChatScreen";

const model = new SimulatedChatModel();
// Reply metrics in the Metro console while developing; plug a real analytics adapter in production.
const telemetry = __DEV__ ? new ConsoleTelemetry() : undefined;

export default function App() {
  return (
    <SafeAreaProvider>
      <ChatScreen model={model} telemetry={telemetry} />
    </SafeAreaProvider>
  );
}
