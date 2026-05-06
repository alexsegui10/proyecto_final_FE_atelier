import type { ChatMessage, DiscoveryEvent } from "./types";
import { mergePRDState, EMPTY_PRD_STATE, type PRDState } from "./prd-state";

type CannedTurn = {
  state: Partial<PRDState>;
  reply: string;
};

const SCRIPT: CannedTurn[] = [
  {
    state: {
      objective: "App de gestión de clases de yoga para un estudio con admin, profesores y alumnos",
      roles: ["admin", "profesor", "alumno"],
    },
    reply:
      "Vale, queda claro: tres roles (admin, profesor, alumno) y el dominio gira alrededor de clases de yoga. Para empezar a aterrizar el modelo, ¿el alumno reserva clases con cupo limitado o son sesiones a demanda?",
  },
  {
    state: {
      entities: [
        { name: "Class", fields: ["title", "startsAt", "capacity", "teacherId"] },
        { name: "Booking", fields: ["userId", "classId", "status"] },
      ],
      useCases: [
        "alumno reserva una clase",
        "alumno cancela una reserva",
        "profesor ve su agenda",
      ],
      notes: ["Las cancelaciones cierran 2 h antes del inicio."],
    },
    reply:
      "Anotado: cupo limitado, cancelación hasta 2 h antes. ¿Hay sistema de membresías o cada clase se paga por separado?",
  },
  {
    state: {
      entities: [
        { name: "Membership", fields: ["userId", "type", "validUntil"] },
      ],
      useCases: [
        "admin crea una clase",
        "admin invalida una reserva",
        "alumno compra una membresía",
      ],
      notes: ["Membresías mensuales o trimestrales, sin clases sueltas."],
    },
    reply:
      "Perfecto, solo membresías. Resumamos:\n\n- Tres roles: admin, profesor, alumno\n- Cuatro entidades: User, Class, Booking, Membership\n- Reglas clave: cupo limitado, cancelación 2 h antes, sin clases sueltas\n\nCreo que tenemos suficiente para arrancar.\n\nREADY_TO_BUILD",
  },
];

function fenceState(state: PRDState): string {
  return `\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function* runDiscoveryAgentFake(
  messages: ChatMessage[],
): AsyncGenerator<DiscoveryEvent> {
  const userTurns = messages.filter((m) => m.role === "user").length;
  const turnIndex = Math.min(userTurns - 1, SCRIPT.length - 1);

  if (turnIndex < 0) {
    yield {
      type: "delta",
      text:
        "Hola, soy el agente de descubrimiento de Atelier. ¿Qué tipo de aplicación querés generar?",
    };
    yield { type: "state", state: EMPTY_PRD_STATE };
    yield { type: "done" };
    return;
  }

  const turn = SCRIPT[turnIndex];

  let runningState: PRDState = EMPTY_PRD_STATE;
  for (let i = 0; i <= turnIndex; i++) {
    runningState = mergePRDState(runningState, SCRIPT[i].state);
  }

  const fenced = fenceState(runningState);
  const fullText = `${fenced}\n\n${turn.reply}`;

  // simulate token-level streaming on the prose part only
  yield { type: "delta", text: fenced + "\n\n" };
  for (const word of turn.reply.split(/(\s+)/)) {
    yield { type: "delta", text: word };
    await sleep(15);
  }

  yield { type: "state", state: runningState };

  if (/READY_TO_BUILD/.test(fullText)) {
    yield { type: "ready", state: runningState };
  }
  yield { type: "done" };
}
