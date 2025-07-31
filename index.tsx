import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';


// --- Custom Hook for localStorage ---
function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue: React.Dispatch<React.SetStateAction<T>> = (value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  };

  return [storedValue, setValue];
}


// --- Type Definitions ---
interface Player {
  id: string;
  name: string;
  lifetimeScore: number;
  gamesPlayed: number;
  wins: number;
}

interface Team {
  name: string;
  players: Player[];
  score: number;
}

interface Teams {
  team1: Team;
  team2: Team;
}

interface RoundData {
    spielmacherId: string;
    bidValue: number;
    meldValues: { [playerId: string]: number };
    trickPoints: { [playerId: string]: number };
    gameAbandoned: boolean;
}

interface RoundCalculationResult {
    team1RoundScore: number;
    team2RoundScore: number;
    playerScores: { [playerId: string]: number };
    reason: string;
}

interface RoundHistoryItem {
  round: number;
  team1RoundScore: number;
  team2RoundScore: number;
  team1Total: number;
  team2Total: number;
  spielmacherId: string;
  spielmacherName: string;
  bidValue: number;
  playerScores: { [playerId: string]: number };
}

interface GameState {
    teams: Teams;
    targetScore: number;
    roundHistory: RoundHistoryItem[];
}

// --- Prop Types ---
interface NavProps {
    view: View;
    setView: (view: View) => void;
    gameInProgress: boolean;
}

interface PlayerStatsScreenProps {
    players: Player[];
    setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
}

interface TeamSelectionScreenProps {
    players: Player[];
    onStartGame: (teams: Teams, targetScore: number) => void;
    onAddPlayer: (name: string) => Player;
}

interface GameScreenProps {
    gameState: GameState;
    onAddRound: (roundData: RoundData) => void;
    onUndoRound: () => void;
    onResetGame: () => void;
    onEndGame: (winner: Team) => void;
}

interface EndGameModalProps {
    teams: Teams;
    onForfeit: (winner: Team) => void;
    onDiscard: () => void;
    onClose: () => void;
}

interface ScoreboardProps {
    teams: Teams;
    targetScore: number;
}

interface RoundInputProps {
    teams: Teams;
    onAddRound: (roundData: RoundData) => void;
}

interface RoundHistoryProps {
    history: RoundHistoryItem[];
    teams: Teams;
}

interface WinnerModalProps {
    winner: Team;
    onReset: () => void;
}

interface MeldAiAnalyzerProps {
    playerName: string;
    onClose: () => void;
    onApplyPoints: (points: number) => void;
}

type View = 'game' | 'stats';

// --- Scoring Logic ---
const calculateRoundScores = (roundData: RoundData, teams: Teams): RoundCalculationResult => {
    const { spielmacherId, bidValue, meldValues, trickPoints, gameAbandoned } = roundData;

    const spielmacherTeamKey = teams.team1.players.some(p => p.id === spielmacherId) ? 'team1' : 'team2';
    const otherTeamKey = spielmacherTeamKey === 'team1' ? 'team2' : 'team1';

    const spielmacherTeam = teams[spielmacherTeamKey];
    const otherTeam = teams[otherTeamKey];

    const playerScores: { [playerId: string]: number } = {};
    let reason = '';

    const getTeamMeld = (team: Team) => team.players.reduce((sum, p) => sum + (meldValues[p.id] || 0), 0);
    const getTeamTricks = (team: Team) => team.players.reduce((sum, p) => sum + (trickPoints[p.id] || 0), 0);
    
    if (gameAbandoned) {
        reason = "Spielmacher hat abgebrochen";
        // Penalty is applied at the team level. Individual player scores are 0 for this round.
        spielmacherTeam.players.forEach(p => playerScores[p.id] = 0);
        // CORRECTED: Other team gets 0 points, not their meld.
        otherTeam.players.forEach(p => playerScores[p.id] = 0);
    } else {
        const spielmacherTeamMeld = getTeamMeld(spielmacherTeam);
        const spielmacherTeamTricks = getTeamTricks(spielmacherTeam);
        const spielmacherTeamTotal = spielmacherTeamMeld + spielmacherTeamTricks;

        if (spielmacherTeamTotal >= bidValue) {
            reason = `Reizwert erreicht (${spielmacherTeamTotal} >= ${bidValue})`;
            spielmacherTeam.players.forEach(p => {
                // CORRECTED: Universal "0 tricks = 0 points" rule
                playerScores[p.id] = (trickPoints[p.id] || 0) === 0 ? 0 : (meldValues[p.id] || 0) + (trickPoints[p.id] || 0);
            });
        } else {
            reason = `Reizwert nicht erreicht (${spielmacherTeamTotal} < ${bidValue})`;
            spielmacherTeam.players.forEach(p => playerScores[p.id] = 0); // No points for loss, team score is penalty
        }

        otherTeam.players.forEach(p => {
            // RULE: No tricks means 0 points for the round, regardless of meld.
            playerScores[p.id] = (trickPoints[p.id] || 0) === 0 ? 0 : (meldValues[p.id] || 0) + (trickPoints[p.id] || 0);
        });
    }

    const getTeamScoreFromPlayerScores = (team: Team) => team.players.reduce((sum, p) => sum + playerScores[p.id], 0);

    let spielmacherTeamRoundScore = getTeamScoreFromPlayerScores(spielmacherTeam);
    
    // Apply penalties at the team level
    if (gameAbandoned) {
        spielmacherTeamRoundScore = -bidValue;
    } else {
         const spielmacherTeamTotal = getTeamMeld(spielmacherTeam) + getTeamTricks(spielmacherTeam);
         if (spielmacherTeamTotal < bidValue) {
            spielmacherTeamRoundScore = -2 * bidValue;
         }
    }
    
    const otherTeamRoundScore = getTeamScoreFromPlayerScores(otherTeam);

    const team1RoundScore = spielmacherTeamKey === 'team1' ? spielmacherTeamRoundScore : otherTeamRoundScore;
    const team2RoundScore = spielmacherTeamKey === 'team2' ? spielmacherTeamRoundScore : otherTeamRoundScore;

    return { team1RoundScore, team2RoundScore, playerScores, reason };
};


const App = () => {
    const [view, setView] = useState<View>('game');
    const [players, setPlayers] = useLocalStorage<Player[]>('binokel-players', []);
    const [activeGame, setActiveGame] = useLocalStorage<GameState | null>('binokel-active-game', null);
    const [winner, setWinner] = useState<Team | null>(null);

    const handleAddPlayer = (name: string): Player => {
        const newPlayer: Player = {
            id: `player-${Date.now()}`,
            name,
            lifetimeScore: 0,
            gamesPlayed: 0,
            wins: 0,
        };
        setPlayers(prev => [...prev, newPlayer]);
        return newPlayer;
    };
    
    const handleStartGame = (teams: Teams, targetScore: number) => {
        setActiveGame({ teams, targetScore, roundHistory: [] });
    };

    const handleAddRound = (roundData: RoundData) => {
        if (!activeGame) return;

        const { team1RoundScore, team2RoundScore, playerScores, reason } = calculateRoundScores(roundData, activeGame.teams);

        // Update player lifetime scores immediately
        setPlayers(prevPlayers => prevPlayers.map(p => {
            if (playerScores[p.id] !== undefined) {
                return { ...p, lifetimeScore: p.lifetimeScore + playerScores[p.id] };
            }
            return p;
        }));

        const updatedTeams: Teams = {
            team1: { ...activeGame.teams.team1, score: activeGame.teams.team1.score + team1RoundScore },
            team2: { ...activeGame.teams.team2, score: activeGame.teams.team2.score + team2RoundScore },
        };
        
        const spielmacher = [...activeGame.teams.team1.players, ...activeGame.teams.team2.players].find(p => p.id === roundData.spielmacherId);

        const newRoundHistoryItem: RoundHistoryItem = {
            round: activeGame.roundHistory.length + 1,
            team1RoundScore,
            team2RoundScore,
            team1Total: updatedTeams.team1.score,
            team2Total: updatedTeams.team2.score,
            spielmacherId: roundData.spielmacherId,
            spielmacherName: spielmacher?.name || '?',
            bidValue: roundData.bidValue,
            playerScores,
        };

        setActiveGame({
            ...activeGame,
            teams: updatedTeams,
            roundHistory: [...activeGame.roundHistory, newRoundHistoryItem],
        });
    };
    
    const handleUndoRound = () => {
        if (!activeGame || activeGame.roundHistory.length === 0) return;

        const lastRound = activeGame.roundHistory[activeGame.roundHistory.length - 1];
        if (!lastRound) return;
        
        // REVERT LIFETIME SCORES
        setPlayers(prevPlayers => prevPlayers.map(p => {
            const pointsToRevert = lastRound.playerScores[p.id] || 0;
            if (pointsToRevert !== 0) {
                return { ...p, lifetimeScore: p.lifetimeScore - pointsToRevert };
            }
            return p;
        }));

        // REVERT GAME STATE
        setActiveGame(prevGame => {
            if (!prevGame) return null;

            const newHistory = prevGame.roundHistory.slice(0, -1);
            const newTeams: Teams = {
                team1: {
                    ...prevGame.teams.team1,
                    score: prevGame.teams.team1.score - lastRound.team1RoundScore,
                },
                team2: {
                    ...prevGame.teams.team2,
                    score: prevGame.teams.team2.score - lastRound.team2RoundScore,
                },
            };

            return {
                ...prevGame,
                teams: newTeams,
                roundHistory: newHistory,
            };
        });
    };
    
    const handleEndGame = (winnerTeam: Team) => {
       if (!activeGame) return;
       
        setWinner(winnerTeam);
        
        const loserTeam = activeGame.teams.team1.name === winnerTeam.name ? activeGame.teams.team2 : activeGame.teams.team1;

        setPlayers(prevPlayers => {
            return prevPlayers.map(p => {
                const updatedPlayer = { ...p };
                let playedInThisGame = false;
                
                if (winnerTeam.players.some(wp => wp.id === p.id)) {
                    updatedPlayer.wins += 1;
                    playedInThisGame = true;
                } else if (loserTeam.players.some(lp => lp.id === p.id)) {
                     playedInThisGame = true;
                }
                
                if(playedInThisGame) {
                    updatedPlayer.gamesPlayed += 1;
                }

                return updatedPlayer;
            });
        });
    };

    const handleReset = () => {
        setWinner(null);
        setActiveGame(null);
        setView('game');
    };

    useEffect(() => {
        if (!activeGame || winner) return;

        const { teams, targetScore } = activeGame;
        if (teams.team1.score >= targetScore) {
            handleEndGame(teams.team1);
        } else if (teams.team2.score >= targetScore) {
            handleEndGame(teams.team2);
        }
    }, [activeGame, winner]);


    return (
        <div>
            {winner && <WinnerModal winner={winner} onReset={handleReset} />}
            <Nav view={view} setView={setView} gameInProgress={!!activeGame} />
            <main>
                {view === 'stats' && <PlayerStatsScreen players={players} setPlayers={setPlayers} />}
                {view === 'game' && !activeGame && <TeamSelectionScreen players={players} onStartGame={handleStartGame} onAddPlayer={handleAddPlayer} />}
                {view === 'game' && activeGame && (
                    <GameScreen 
                        gameState={activeGame}
                        onAddRound={handleAddRound}
                        onUndoRound={handleUndoRound}
                        onResetGame={handleReset}
                        onEndGame={handleEndGame}
                    />
                )}
            </main>
        </div>
    );
};

const Nav = ({ view, setView, gameInProgress }: NavProps) => (
    <nav className="main-nav">
        <button onClick={() => setView('game')} className={view === 'game' ? 'active' : ''}>
            {gameInProgress ? 'Aktuelles Spiel' : 'Neues Spiel'}
        </button>
        <button onClick={() => setView('stats')} className={view === 'stats' ? 'active' : ''}>
            Spieler-Verwaltung
        </button>
    </nav>
);

const PlayerStatsScreen = ({ players, setPlayers }: PlayerStatsScreenProps) => {
    const [newPlayerName, setNewPlayerName] = useState('');

    const handleAddPlayer = (e: React.FormEvent) => {
        e.preventDefault();
        if (newPlayerName.trim()) {
            const newPlayer: Player = {
                id: `player-${Date.now()}`,
                name: newPlayerName.trim(),
                lifetimeScore: 0,
                gamesPlayed: 0,
                wins: 0,
            };
            setPlayers(prev => [...prev, newPlayer]);
            setNewPlayerName('');
        }
    };
    
    const handleDeletePlayer = (playerId: string) => {
        if(window.confirm("Soll dieser Spieler wirklich gelöscht werden? Alle Statistiken gehen verloren.")) {
           setPlayers(prev => prev.filter(p => p.id !== playerId));
        }
    }
    
    return (
        <div className="card">
            <h2>Spieler-Verwaltung & Statistiken</h2>
            <form onSubmit={handleAddPlayer} className="add-player-form">
                <input
                    type="text"
                    value={newPlayerName}
                    onChange={e => setNewPlayerName(e.target.value)}
                    placeholder="Neuen Spieler anlegen"
                />
                <button type="submit" className="btn btn-small">+</button>
            </form>
             <div className="table-container">
                <table className="player-stats-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Siege</th>
                            <th>Spiele</th>
                            <th>Punkte Gesamt</th>
                            <th>Aktion</th>
                        </tr>
                    </thead>
                    <tbody>
                        {players.length > 0 ? players.map(p => (
                            <tr key={p.id}>
                                <td>{p.name}</td>
                                <td>{p.wins}</td>
                                <td>{p.gamesPlayed}</td>
                                <td>{p.lifetimeScore}</td>
                                <td><button className="btn-delete" onClick={() => handleDeletePlayer(p.id)}>X</button></td>
                            </tr>
                        )) : (
                            <tr><td colSpan={5}>Noch keine Spieler angelegt.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const TeamSelectionScreen = ({ players, onStartGame, onAddPlayer }: TeamSelectionScreenProps) => {
    const [team1p1, setTeam1p1] = useState<string>('');
    const [team1p2, setTeam1p2] = useState<string>('');
    const [team2p1, setTeam2p1] = useState<string>('');
    const [team2p2, setTeam2p2] = useState<string>('');
    const [targetScore, setTargetScore] = useState(1500);
    const [newPlayerName, setNewPlayerName] = useState('');

    const selectedPlayerIds = useMemo(() => new Set([team1p1, team1p2, team2p1, team2p2].filter(Boolean)), [team1p1, team1p2, team2p1, team2p2]);
    
    const handleStart = () => {
        if (selectedPlayerIds.size !== 4) return;
        
        const p1_1 = players.find(p => p.id === team1p1)!;
        const p1_2 = players.find(p => p.id === team1p2)!;
        const p2_1 = players.find(p => p.id === team2p1)!;
        const p2_2 = players.find(p => p.id === team2p2)!;

        const newTeams: Teams = {
            team1: { name: `${p1_1.name} & ${p1_2.name}`, players: [p1_1, p1_2], score: 0 },
            team2: { name: `${p2_1.name} & ${p2_2.name}`, players: [p2_1, p2_2], score: 0 },
        };
        onStartGame(newTeams, targetScore);
    };

    const handleAddNewPlayer = () => {
        if (newPlayerName.trim() === '') return;
        onAddPlayer(newPlayerName);
        setNewPlayerName('');
    }

    const renderPlayerOptions = (excludeId?: string) => (
        players
            .filter(p => !selectedPlayerIds.has(p.id) || p.id === excludeId)
            .map(p => <option key={p.id} value={p.id}>{p.name}</option>)
    );

    return (
        <div>
            <h1>Neues Spiel starten</h1>
            <div className="card">
                <h2>Teams zusammenstellen</h2>
                 <div className="team-selection-grid">
                    <div className="team-column">
                        <h3>Team 1</h3>
                        <select value={team1p1} onChange={e => setTeam1p1(e.target.value)}>
                            <option value="">Spieler 1 wählen</option>
                            {renderPlayerOptions(team1p1)}
                        </select>
                        <select value={team1p2} onChange={e => setTeam1p2(e.target.value)}>
                            <option value="">Spieler 2 wählen</option>
                            {renderPlayerOptions(team1p2)}
                        </select>
                    </div>
                    <div className="team-column">
                        <h3>Team 2</h3>
                        <select value={team2p1} onChange={e => setTeam2p1(e.target.value)}>
                            <option value="">Spieler 1 wählen</option>
                             {renderPlayerOptions(team2p1)}
                        </select>
                        <select value={team2p2} onChange={e => setTeam2p2(e.target.value)}>
                            <option value="">Spieler 2 wählen</option>
                             {renderPlayerOptions(team2p2)}
                        </select>
                    </div>
                </div>
                <div className="add-player-inline">
                    <input type="text" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} placeholder="Oder schnell neuen Spieler anlegen..."/>
                    <button onClick={handleAddNewPlayer} className="btn btn-small">+</button>
                </div>
            </div>
            <div className="card">
                <h2>Spieleinstellungen</h2>
                <div className="form-group">
                    <label htmlFor="targetScore">Zielpunktzahl</label>
                    <input type="number" id="targetScore" value={targetScore} onChange={(e) => setTargetScore(Number(e.target.value))} step="50"/>
                </div>
            </div>
            <button className="btn" onClick={handleStart} disabled={selectedPlayerIds.size !== 4}>
                Spiel starten
            </button>
        </div>
    );
};


const GameScreen = ({ gameState, onAddRound, onUndoRound, onResetGame, onEndGame }: GameScreenProps) => {
  const {teams, targetScore, roundHistory} = gameState;
  const [isEndGameModalOpen, setEndGameModalOpen] = useState(false);
  
  const handleEndGameClick = () => {
    setEndGameModalOpen(true);
  }
  
  const handleCloseModal = () => {
    setEndGameModalOpen(false);
  }

  const handleForfeit = (winner: Team) => {
    onEndGame(winner);
    handleCloseModal();
  }

  const handleDiscard = () => {
    if (window.confirm("Soll das Spiel wirklich verworfen werden? Der Spielstand geht verloren und es wird keine Statistik erfasst.")) {
        onResetGame();
        handleCloseModal();
    }
  }

  return (
    <div>
      {isEndGameModalOpen && (
        <EndGameModal 
            teams={teams}
            onForfeit={handleForfeit}
            onDiscard={handleDiscard}
            onClose={handleCloseModal}
        />
      )}
      <h1 style={{ marginBottom: '1rem' }}>Binokel Zähler</h1>
      <Scoreboard teams={teams} targetScore={targetScore} />
      <RoundInput teams={teams} onAddRound={onAddRound} />
      <div className="game-controls">
         <button className="btn btn-secondary" onClick={onUndoRound} disabled={roundHistory.length === 0}>Letzte Runde zurücknehmen</button>
         <button className="btn btn-danger" onClick={handleEndGameClick}>Aktuelles Spiel beenden</button>
      </div>
      <RoundHistory history={roundHistory} teams={teams}/>
    </div>
  );
};


const Scoreboard = ({ teams, targetScore }: ScoreboardProps) => {
  const getProgress = (score: number) => {
    if (score <= 0 || targetScore === 0) return 0;
    return Math.min((score / targetScore) * 100, 100);
  };

  return (
    <div className="scoreboard">
      {Object.values(teams).map((team: Team) => (
        <div className="card team-card" key={team.name}>
          <h3>{team.name.split(' & ')[0]} &<br/>{team.name.split(' & ')[1]}</h3>
          <p className="score">{team.score}</p>
          <div className="progress-bar-container">
            <div 
              className="progress-bar" 
              style={{ width: `${getProgress(team.score)}%` }}
              aria-valuenow={team.score}
              aria-valuemin={0}
              aria-valuemax={targetScore}
            ></div>
          </div>
        </div>
      ))}
    </div>
  );
};

interface ReviewData {
    calculation: RoundCalculationResult;
    rawData: RoundData;
}

const RoundInput = ({ teams, onAddRound }: RoundInputProps) => {
    const allPlayers = useMemo(() => [...teams.team1.players, ...teams.team2.players], [teams]);

    const [spielmacherId, setSpielmacherId] = useState<string>(allPlayers[0]?.id || '');
    const [bidValue, setBidValue] = useState(150);
    const [meldValues, setMeldValues] = useState<{ [key: string]: string }>({});
    const [trickPoints, setTrickPoints] = useState<{ [key: string]: string }>({});
    const [gameAbandoned, setGameAbandoned] = useState(false);
    const [reviewData, setReviewData] = useState<ReviewData | null>(null);

    const resetForm = () => {
        const initialPlayerValues = allPlayers.reduce((acc, player) => ({ ...acc, [player.id]: '' }), {});
        setMeldValues(initialPlayerValues);
        setTrickPoints(initialPlayerValues);
        setSpielmacherId(allPlayers[0]?.id || '');
        setBidValue(150);
        setGameAbandoned(false);
        setReviewData(null);
    };

    useEffect(() => {
        resetForm();
    }, [allPlayers.map(p => p.id).join(',')]);
    
    const handlePlayerValueChange = (
        setter: React.Dispatch<React.SetStateAction<{ [key: string]: string }>>,
        playerId: string,
        value: string
    ) => {
        setter(prev => ({ ...prev, [playerId]: value }));
    };

    const totalTrickPoints = useMemo(() => {
        return Object.values(trickPoints).reduce((sum, points) => sum + (Number(points) || 0), 0);
    }, [trickPoints]);
    
    const remainingTrickPoints = 240 - totalTrickPoints;

    const handleReview = (e: React.FormEvent) => {
        e.preventDefault();

        const numericMeldValues = Object.entries(meldValues).reduce((acc, [id, val]) => ({ ...acc, [id]: Number(val) || 0 }), {});
        const numericTrickPoints = Object.entries(trickPoints).reduce((acc, [id, val]) => ({ ...acc, [id]: Number(val) || 0 }), {});
        
        const rawData: RoundData = {
            spielmacherId,
            bidValue,
            meldValues: numericMeldValues,
            trickPoints: numericTrickPoints,
            gameAbandoned
        };
        
        const calculation = calculateRoundScores(rawData, teams);

        setReviewData({
            calculation,
            rawData
        });
    };

    const handleConfirmRound = () => {
        if (!reviewData) return;
        onAddRound(reviewData.rawData);
        resetForm();
    };

    const handleCancelReview = () => {
        setReviewData(null);
    };
    
    const isSubmitDisabled = !gameAbandoned && remainingTrickPoints !== 0;

    if (reviewData) {
        return (
             <div className="card">
                <h2>Runde prüfen</h2>
                <div className="review-details">
                    {[teams.team1, teams.team2].map(team => (
                        <div key={team.name} className="review-details-team">
                            <h4>{team.name}</h4>
                            <table className="review-table">
                               <thead><tr><th>Spieler</th><th>Meldung</th><th>Stiche</th><th>Punkte</th></tr></thead>
                               <tbody>
                                {team.players.map(player => (
                                    <tr key={player.id}>
                                        <td>{player.name}</td>
                                        <td>{reviewData.rawData.meldValues[player.id] || 0}</td>
                                        <td>{reviewData.rawData.trickPoints[player.id] || 0}</td>
                                        <td className="review-player-points">{reviewData.calculation.playerScores[player.id]}</td>
                                    </tr>
                                ))}
                               </tbody>
                            </table>
                        </div>
                    ))}
                </div>

                <div className="review-summary">
                    <div className="review-team-result">
                        <h4>{teams.team1.name}</h4>
                        <p className={reviewData.calculation.team1RoundScore < 0 ? 'danger' : 'success'}>
                            {reviewData.calculation.team1RoundScore >= 0 && '+'}{reviewData.calculation.team1RoundScore} Punkte
                        </p>
                    </div>
                     <div className="review-team-result">
                        <h4>{teams.team2.name}</h4>
                        <p className={reviewData.calculation.team2RoundScore < 0 ? 'danger' : 'success'}>
                             {reviewData.calculation.team2RoundScore >= 0 && '+'}{reviewData.calculation.team2RoundScore} Punkte
                        </p>
                    </div>
                </div>
                <p className="review-reason">
                    <strong>Begründung:</strong> {reviewData.calculation.reason}
                </p>
                <div className="review-controls">
                    <button className="btn" onClick={handleConfirmRound}>Runde abschließen</button>
                    <button className="btn btn-secondary" onClick={handleCancelReview}>Eingabe anpassen</button>
                </div>
            </div>
        )
    }

    return (
        <div className="card">
            <h2>Nächste Runde eintragen</h2>
            <form onSubmit={handleReview}>
                <div className="round-setup">
                     <div className="form-group">
                        <label>Spielmacher</label>
                        <select value={spielmacherId} onChange={e => setSpielmacherId(e.target.value)}>
                            {allPlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                    </div>
                    <div className="form-group">
                        <label>Reizwert</label>
                        <input type="number" value={bidValue} onChange={e => setBidValue(Number(e.target.value))} step="10" />
                    </div>
                </div>

                <div className="player-inputs-table">
                    <div className="player-inputs-header">
                        <div>Spieler</div>
                        <div>Meldewert</div>
                        <div>Stichpunkte</div>
                    </div>

                    {[teams.team1, teams.team2].map((team) => (
                       <React.Fragment key={team.name}>
                            <h4 className="team-divider">{team.name}</h4>
                            {team.players.map(player => (
                                <div key={player.id} className="player-inputs-row">
                                    <div>{player.name}</div>
                                    <div>
                                        <input 
                                            type="number" 
                                            value={meldValues[player.id] || ''}
                                            onChange={e => handlePlayerValueChange(setMeldValues, player.id, e.target.value)}
                                            placeholder="0" 
                                        />
                                    </div>
                                    <div>
                                    <input 
                                            type="number" 
                                            value={trickPoints[player.id] || ''}
                                            onChange={e => handlePlayerValueChange(setTrickPoints, player.id, e.target.value)}
                                            placeholder="0" 
                                            disabled={gameAbandoned}
                                        />
                                    </div>
                                </div>
                            ))}
                        </React.Fragment>
                    ))}
                </div>
                
                <div className="round-footer">
                    <div className="abandon-game-check">
                         <input type="checkbox" id="gameAbandoned" checked={gameAbandoned} onChange={e => setGameAbandoned(e.target.checked)} />
                         <label htmlFor="gameAbandoned">Spielmacher hat abgebrochen</label>
                    </div>
                    {!gameAbandoned && <div className={`remaining-points ${remainingTrickPoints !== 0 ? 'error' : 'success'}`}>
                        Verbleibende Stichpunkte: {remainingTrickPoints}
                    </div>}
                </div>
                
                <button type="submit" className="btn" disabled={isSubmitDisabled} style={{marginTop: '1.5rem'}}>Runde prüfen</button>
            </form>
        </div>
    );
};

const RoundHistory = ({ history, teams }: RoundHistoryProps) => {
    if (history.length === 0) return null;

    const getTeamForPlayer = (playerId: string): 'team1' | 'team2' | null => {
        if (teams.team1.players.some(p => p.id === playerId)) return 'team1';
        if (teams.team2.players.some(p => p.id === playerId)) return 'team2';
        return null;
    }

    return (
        <div className="card">
            <h2>Rundenverlauf</h2>
            <div className="table-container">
                <table className="round-history-table">
                    <thead>
                        <tr>
                            <th>Runde</th>
                            <th>Reizwert</th>
                            <th>Team 1<br/>Punkte</th>
                            <th>Total</th>
                            <th>Team 2<br/>Punkte</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.slice().reverse().map((round: RoundHistoryItem) => {
                            const spielmacherTeam = getTeamForPlayer(round.spielmacherId);
                            return (
                               <tr key={round.round} className={spielmacherTeam === 'team1' ? 'bid-team1' : 'bid-team2'}>
                                    <td>{round.round}</td>
                                    <td>{round.bidValue} ({round.spielmacherName.substring(0,3)}.)</td>
                                    <td className={round.team1RoundScore < 0 ? 'danger' : ''}>{round.team1RoundScore > 0 ? `+${round.team1RoundScore}` : round.team1RoundScore}</td>
                                    <td>{round.team1Total}</td>
                                    <td className={round.team2RoundScore < 0 ? 'danger' : ''}>{round.team2RoundScore > 0 ? `+${round.team2RoundScore}` : round.team2RoundScore}</td>
                                    <td>{round.team2Total}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const EndGameModal = ({ teams, onForfeit, onDiscard, onClose }: EndGameModalProps) => {
    return (
        <div className="modal-overlay">
            <div className="card modal-content">
                <h2>Spiel beenden?</h2>
                <p>Wie soll das aktuelle Spiel beendet werden?</p>
                <div className="modal-actions">
                    <button className="btn" onClick={() => onForfeit(teams.team2)}>Team 1 gibt auf</button>
                    <button className="btn" onClick={() => onForfeit(teams.team1)}>Team 2 gibt auf</button>
                    <button className="btn btn-secondary" onClick={onDiscard}>Spiel verwerfen (keine Wertung)</button>
                    <button className="btn btn-secondary" onClick={onClose}>Abbrechen & Weiterspielen</button>
                </div>
            </div>
        </div>
    );
}

const Confetti = () => {
    const confettiCount = 150; 
    const colors = ['#c0392b', '#27ae60', '#f1c40f', '#3498db', '#9b59b6', '#e67e22'];
    
    return (
        <div className="confetti-container">
            {Array.from({ length: confettiCount }).map((_, i) => (
                <div key={i} className="confetti-piece" style={{
                    left: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 5}s`,
                    animationDuration: `${3 + Math.random() * 3}s`,
                    backgroundColor: colors[i % colors.length]
                }}></div>
            ))}
        </div>
    );
};


const WinnerModal = ({ winner, onReset }: WinnerModalProps) => {
    return (
        <div className="winner-modal">
            <Confetti />
            <div className="card winner-card">
                <h2>🎉 Glückwunsch! 🎉</h2>
                <p><strong>{winner.name}</strong> hat das Spiel gewonnen!</p>
                <button className="btn" onClick={onReset}>Neues Spiel starten</button>
            </div>
        </div>
    )
}

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}
