/* Visual effects consume only public, server-validated actions. They never delay a turn. */
const gameEffects = (() => {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const colors = {
    red: "#f05c67",
    blue: "#5486ed",
    green: "#65bc95",
    yellow: "#f4c363",
  };
  const colorNames = {
    red: "Rouge",
    blue: "Bleu",
    green: "Vert",
    yellow: "Jaune",
  };
  const animations = new Set();
  let timer = null;

  function motion(element, frames, options) {
    const animation = element.animate(frames, options);
    animations.add(animation);
    animation.finished
      .catch(() => {})
      .finally(() => {
        animations.delete(animation);
        if (element.classList.contains("effect-fly-card")) element.remove();
      });
  }

  function flyCards(amount, recipient, self) {
    if (!amount) return;
    const table = document.querySelector("#table");
    const layer = document.querySelector("#effect-layer");
    const bounds = table.getBoundingClientRect();
    const pile = document.querySelector("#draw-card").getBoundingClientRect();
    const opponent = [...document.querySelectorAll(".opponent")].find(
      (p) => p.dataset.player === recipient,
    );
    const target = opponent?.getBoundingClientRect();
    const x = pile.left + pile.width / 2 - bounds.left;
    const y = pile.top + pile.height / 2 - bounds.top;
    const endX =
      recipient === self
        ? bounds.width / 2
        : target
          ? target.left + target.width / 2 - bounds.left
          : bounds.width / 2;
    const endY =
      recipient === self
        ? bounds.height - 15
        : target
          ? target.top + 16 - bounds.top
          : 30;
    for (let i = 0; i < Math.min(amount, 8); i++) {
      const card = document.createElement("span");
      card.className = "effect-fly-card";
      card.textContent = "u.";
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      layer.append(card);
      motion(
        card,
        [
          {
            transform: "translate(-50%, -50%) rotate(-8deg) scale(.4)",
            opacity: 0,
          },
          {
            transform: "translate(-50%, -90%) rotate(10deg) scale(1)",
            opacity: 1,
            offset: 0.2,
          },
          {
            transform: `translate(calc(-50% + ${endX - x}px), calc(-50% + ${endY - y}px)) rotate(${i % 2 ? 20 : -20}deg) scale(.35)`,
            opacity: 0,
          },
        ],
        {
          duration: 700,
          delay: i * 65,
          easing: "cubic-bezier(.2,.65,.3,1)",
          fill: "both",
        },
      );
    }
  }

  function showSpecial(action, context) {
    const layer = document.querySelector("#effect-layer");
    const effect = document.createElement("div");
    const panel = document.createElement("div");
    const kicker = document.createElement("span");
    const symbol = document.createElement("strong");
    const label = document.createElement("span");
    const detail = document.createElement("span");
    panel.className = "effect-announcement";
    kicker.className = "effect-kicker";
    symbol.className = "effect-symbol";
    label.className = "effect-label";
    detail.className = "effect-detail";
    kicker.textContent = context.actorName;
    const value = action.card?.value;
    const kind = action.type === "penalty" ? "penalty" : value;
    effect.className = `special-effect effect-${kind}`;
    effect.dataset.action = action.id;
    effect.style.setProperty(
      "--effect-color",
      colors[action.color] || "#c6f783",
    );
    if (value === "draw2" || value === "wild4") {
      symbol.textContent = value === "draw2" ? "+2" : "+4";
      label.textContent = action.settled
        ? `+${action.total} pour finir !`
        : action.total > (value === "draw2" ? 2 : 4)
          ? `La chaîne monte à +${action.total}`
          : "La pression monte.";
      detail.textContent = action.settled
        ? `${context.targetName} pioche, la manche est terminée.`
        : `${context.targetName}, à vous de surenchérir !`;
      if (action.settled) flyCards(action.total, action.target, context.self);
    } else if (value === "reverse") {
      symbol.textContent = "↻";
      symbol.classList.toggle("counterclockwise", action.direction === -1);
      label.textContent = "Changement de sens !";
      detail.textContent =
        action.direction === 1
          ? "On repart dans le sens horaire."
          : "On repart dans l’autre sens.";
    } else if (value === "skip") {
      symbol.textContent = "⊘";
      label.textContent = "Tour sauté !";
      detail.textContent = `${context.targetName}, ce sera pour le prochain tour.`;
    } else if (value === "wild") {
      symbol.textContent = "✦";
      label.textContent = `Place au ${colorNames[action.color].toLowerCase()} !`;
      detail.textContent = "Nouvelle couleur. Nouvelle stratégie.";
    } else {
      symbol.textContent = `+${action.amount}`;
      label.textContent = "Fin de la chaîne !";
      detail.textContent = `${context.actorName} pioche et passe son tour.`;
      flyCards(action.amount, action.actor, context.self);
    }
    // Colored orbiting cards emphasize + effects; four swatches emphasize wilds.
    if (["draw2", "wild4", "wild"].includes(value)) {
      const orbit = document.createElement("div");
      orbit.className = "effect-orbit";
      for (let i = 0; i < 4; i++) {
        const particle = document.createElement("i");
        particle.className = `effect-particle particle-${i}`;
        orbit.append(particle);
      }
      effect.append(orbit);
    }
    panel.append(kicker, symbol, label, detail);
    effect.append(panel);
    layer.append(effect);
    timer = setTimeout(() => {
      effect.remove();
    }, 1300);
  }

  function reset() {
    clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    animations.clear();
    document.querySelector("#effect-layer")?.replaceChildren();
  }

  function play(action, context) {
    // A new move supersedes the previous effect: totals must never lag behind play.
    reset();
    if (!action || reducedMotion.matches || document.hidden) return;
    if (action.type === "play") {
      const discard = document.querySelector("#discard-card .card");
      if (discard)
        motion(
          discard,
          [
            {
              transform: "translateY(-25px) rotate(-14deg) scale(1.18)",
              opacity: 0.3,
            },
            { transform: "translateY(0) rotate(0) scale(1)", opacity: 1 },
          ],
          { duration: 350, easing: "cubic-bezier(.2,.8,.3,1)" },
        );
      if (action.color !== action.previousColor) {
        const color = document.querySelector("#current-color");
        motion(
          color,
          [
            { transform: "scale(1)", filter: "brightness(1)" },
            {
              transform: "scale(1.12)",
              filter: "brightness(1.8)",
              offset: 0.5,
            },
            { transform: "scale(1)", filter: "brightness(1)" },
          ],
          { duration: 650 },
        );
      }
    }
    if (action.type === "draw") {
      flyCards(action.amount, action.actor, context.self);
      return;
    }
    if (
      action.type !== "penalty" &&
      !["draw2", "wild4", "reverse", "skip", "wild"].includes(
        action.card?.value,
      )
    )
      return;
    showSpecial(action, context);
  }
  reducedMotion.addEventListener("change", reset);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) reset();
  });
  return { play, reset };
})();
