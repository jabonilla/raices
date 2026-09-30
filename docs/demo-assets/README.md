# Raíces — Demo para socios liquidadores

**Escenario:** Carlos trabaja en EE. UU. Su mamá, María, vive en Guatemala. Carlos le quiere enviar $25 para víveres.

**El problema que resolvemos:** Las remesas tradicionales son caras, lentas y opacas. María no tiene cuenta bancaria ni smartphone con apps — solo usa WhatsApp. Raíces permite que Carlos envíe desde EE. UU. y María reciba por WhatsApp, sin instalar nada.

---

## 1. Invitación — Carlos invita a Mamá

Carlos abre Raíces y toca "Invitar". Escribe el nombre ("Mamá") y el número de teléfono de Guatemala (+502...). Toca "Enviar invitación".

**Lo que pasa:** El sistema le manda a María un mensaje por WhatsApp. Ella no tiene que descargar ninguna app ni crear una cuenta. Cuando acepte la invitación, Carlos la va a ver en su lista de personas.

**Por qué importa:** La barrera de entrada es cero para el recipiente. Si María tuviera que instalar una app, la mitad de los usuarios se perderían aquí.

## 2. Solicitud — $25 para víveres

Carlos selecciona a Mamá, escribe $25.00 y el motivo: "Víveres". Toca "Enviar ahora".

**Lo que pasa:** La solicitud se crea pero el dinero NO se mueve todavía. Queda en estado pendiente, esperando aprobación. El motivo ("Víveres") queda registrado — cada movimiento de dinero declara su propósito.

**Por qué importa:** El "motivo" no es un campo opcional. Es parte del diseño: el sistema sabe por qué se mueve cada dólar, lo que permite controles y auditoría que las remesas tradicionales no tienen.

## 3. Aprobación — El gate

Carlos ve la solicitud pendiente en su pantalla de Aprobaciones: "$25.00 para Mamá — Motivo: Víveres". Tiene dos botones: "Todavía no" o "Aprobar $25.00".

**Lo que pasa:** Nada se mueve hasta que Carlos aprueba. Este es el gate de aprobación — un control deliberado, no un bug. Cuando aprueba, el sistema registra el movimiento en un libro contable balanceado: los débitos siempre igualan a los créditos. No hay forma de que el dinero "desaparezca".

**Por qué importa:** Para un socio liquidador, esto es lo crítico. El libro append-only con débitos=créditos significa que cada centavo es rastreable. Si algo sale mal, el libro dice exactamente dónde está el dinero.

## 4. Llegada — WhatsApp para Mamá

La transferencia aparece como "APROBADO" en el historial de Carlos. María recibe un mensaje de WhatsApp: "Carlos te envió $25.00 para víveres. Respondé SÍ para recibirlo."

**Lo que pasa:** María responde por WhatsApp — no necesita la app de Raíces. El socio liquidador en Guatemala entrega los $25 (o el equivalente en quetzales) a María. El sistema registra la entrega y cierra el ciclo.

**Por qué importa:** Todo el flujo del lado del recipiente pasa por WhatsApp. El socio liquidador solo necesita saber: ¿a quién?, ¿cuánto?, ¿ya aprobó el remitente? El resto lo maneja Raíces.

---

## Resumen para el socio

| Pregunta | Respuesta |
|----------|-----------|
| ¿Qué necesito instalar? | Nada. Operás por WhatsApp o un panel web simple. |
| ¿Cómo sé que el dinero es real? | El libro contable balanceado lo garantiza. Débitos = créditos, siempre. |
| ¿Qué pasa si el remitente no aprueba? | El dinero no se mueve. La solicitud expira o se cancela. |
| ¿El recipiente necesita smartphone? | No. Solo WhatsApp, que ya usa. |
| ¿En qué idioma está? | Español (voseo guatemalteco) e inglés. |

**Archivos:** `01-invite.html`, `02-request.html`, `03-approval.html`, `04-arrival.html` — abrir en navegador a 390×844 para capturas.
