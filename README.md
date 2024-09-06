# Lichess-Limbot
Limbot is a chess bot for [Lichess](https://lichess.org/). The bot's goal is to keep the game almost equal for as long as possible to annoy the opponent (and hopefully make them quit chess).

## How to Use
1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser.
2. Copy and save the script from the `script.js` file to Tampermonkey.
3. Join a game on [Lichess](https://lichess.org/) (1+0 bullet recommended). The bot will start playing automatically.

## Customization
You can customize Limbot's behavior by modifying the script:
- **`getMoveDelay`**: Adjusts the delay between moves
- **`getTargetEvaluation`**: Sets the target evaluation for each move

## Note
- Never use Limbot on your Lichess account as you will certainly get banned.
- Limbot may draw since the bot is designed to avoid getting a decisive advantage too early, or even lose on time if the move delay rolls are extremely unlucky.

## TODO
- [ ] Implement human-like premoves and advanced time management
- [ ] Adjust move times for different time controls besides bullet
- [ ] Enable auto-finding of new games or auto-rematch
- [ ] Add a "Give 15 seconds" feature for maximum annoyance
