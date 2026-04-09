export const CATEGORY_COLORS = {
  'Ball Striking': '#52c41a',
  'Short Game': '#f4d03f',
  'Putting': '#4a90d9',
  'Driver': '#f39c12',
  'Wedges': '#e74c3c',
  'Bunker': '#d4af37',
  'Tournament Simulation': '#9b59b6',
  'Mental Game': '#ff6b9d',
};

export const CATEGORIES = [
  'Ball Striking',
  'Short Game',
  'Putting',
  'Driver',
  'Wedges',
  'Bunker',
  'Tournament Simulation',
  'Mental Game',
];

export const DRILLS = [
  // Ball Striking
  { id: 'bs_1', category: 'Ball Striking', name: 'Dynamic Warm-Up + Half Swings', duration: 10, description: 'Stretch + slow 50% swings with wedge' },
  { id: 'bs_2', category: 'Ball Striking', name: 'Low-Point Control Drill', duration: 15, description: 'Place towel 2-3 inches behind ball, strike ball without touching towel' },
  { id: 'bs_3', category: 'Ball Striking', name: '9-Shot Window Drill', duration: 15, description: 'Hit Low/Mid/High and Draw/Straight/Fade with 7-iron' },
  { id: 'bs_4', category: 'Ball Striking', name: 'Distance Ladder Wedges', duration: 15, description: 'Targets at 40, 60, 80, 100 yards' },
  { id: 'bs_5', category: 'Ball Striking', name: 'Random Iron Targets', duration: 20, description: 'Switch clubs every shot, simulate course pressure' },
  { id: 'bs_6', category: 'Ball Striking', name: 'Contact Challenge', duration: 15, description: 'Goal: 8/10 solid strikes before moving clubs' },
  { id: 'bs_7', category: 'Ball Striking', name: 'Strike Combine', duration: 20, description: '7-iron only, 10 shots scored: +2=solid+on line, +1=playable, 0=miss. Goal: 15+ points' },
  { id: 'bs_8', category: 'Ball Striking', name: 'Random Club Challenge', duration: 20, description: 'Change club every shot, pick different targets, full routine every swing' },
  { id: 'bs_9', category: 'Ball Striking', name: 'Miss Management Drill', duration: 15, description: 'Intentionally hit slight push and slight pull, learn control of misses' },
  { id: 'bs_10', category: 'Ball Striking', name: 'Tight Dispersion Test', duration: 15, description: '8 shots must finish inside 20-yard window, restart if you miss 3' },
  { id: 'bs_11', category: 'Ball Striking', name: 'Pressure Finish', duration: 10, description: '5 perfect strikes in a row or restart' },
  { id: 'bs_12', category: 'Ball Striking', name: 'Alignment Station', duration: 15, description: 'Set up alignment sticks, hit 20 balls focusing on setup' },
  { id: 'bs_13', category: 'Ball Striking', name: 'Tempo Drill', duration: 15, description: 'Count 1-2-3 rhythm on every swing' },
  { id: 'bs_14', category: 'Ball Striking', name: '50% Effort Drill', duration: 15, description: 'Hit shots at half speed focusing on contact' },
  { id: 'bs_15', category: 'Ball Striking', name: 'Swing Plane', duration: 20, description: 'Use alignment stick in ground to check swing plane' },

  // Short Game
  { id: 'sg_1', category: 'Short Game', name: 'Basic Chip Technique', duration: 10, description: 'Landing spot focus only' },
  { id: 'sg_2', category: 'Short Game', name: 'Landing Zone Drill', duration: 15, description: 'Towel landing area, ball must land on towel' },
  { id: 'sg_3', category: 'Short Game', name: 'One-Club Challenge', duration: 15, description: 'Use ONLY PW or 9-iron for all shots' },
  { id: 'sg_4', category: 'Short Game', name: 'Up-and-Down Simulation', duration: 20, description: 'Chip then putt out every ball, keep score' },
  { id: 'sg_5', category: 'Short Game', name: 'Rough vs Fairway Lies', duration: 15, description: 'Alternate lies every shot' },
  { id: 'sg_6', category: 'Short Game', name: 'Pressure Finish', duration: 15, description: 'Make 5 up-and-downs in a row before leaving' },
  { id: 'sg_7', category: 'Short Game', name: 'Landing Spot Ladder', duration: 15, description: '5 different landing spots, must hit each twice before moving on' },
  { id: 'sg_8', category: 'Short Game', name: 'Up-and-Down Combine', duration: 25, description: '9 balls different lies: 2=up&down, 1=2putt, 0=worse. Goal: 12+' },
  { id: 'sg_9', category: 'Short Game', name: 'One-Ball Pressure', duration: 15, description: 'Drop 1 ball must get up and down, repeat 10 times' },
  { id: 'sg_10', category: 'Short Game', name: 'Short-Sided Drill', duration: 10, description: 'Hardest shots only, ball short-sided to pin' },
  { id: 'sg_11', category: 'Short Game', name: 'Finish or Leave', duration: 10, description: 'Must make 3 up-and-downs in a row to end' },
  { id: 'sg_12', category: 'Short Game', name: 'Bump and Run', duration: 15, description: 'Use 7-9 iron to chip and run to targets' },
  { id: 'sg_13', category: 'Short Game', name: 'Fringe Drill', duration: 10, description: 'Practice chipping from just off the green' },

  // Putting
  { id: 'pt_1', category: 'Putting', name: 'Gate Drill', duration: 15, description: 'Two tees slightly wider than putter head, putt through without hitting them' },
  { id: 'pt_2', category: 'Putting', name: '3-6-9 Distance Control', duration: 15, description: 'Putt from 3, 6, 9 feet making 3 in a row, stop ball inside 1-foot circle' },
  { id: 'pt_3', category: 'Putting', name: 'Around-the-World', duration: 15, description: '3-5 feet full circle around hole' },
  { id: 'pt_4', category: 'Putting', name: 'Lag Putting', duration: 20, description: '30-50 ft putts finish inside 3 ft' },
  { id: 'pt_5', category: 'Putting', name: 'One-Ball Routine Practice', duration: 15, description: 'Full routine every putt' },
  { id: 'pt_6', category: 'Putting', name: 'Pressure Test', duration: 10, description: 'Make 10 straight 4-footers' },
  { id: 'pt_7', category: 'Putting', name: 'Start Line Gate', duration: 15, description: '20 perfect putts through gate' },
  { id: 'pt_8', category: 'Putting', name: 'Distance Control Combine', duration: 20, description: '20, 30, 40, 50 ft all must finish inside 3 ft' },
  { id: 'pt_9', category: 'Putting', name: '5-Foot Circle Drill', duration: 15, description: '10 spots around hole, must make 8/10' },
  { id: 'pt_10', category: 'Putting', name: 'Lag Pressure', duration: 15, description: '5 balls from 40+ ft all inside 3 ft or restart' },
  { id: 'pt_11', category: 'Putting', name: 'Clutch Finish', duration: 10, description: 'Make 15 straight 4-footers' },
  { id: 'pt_12', category: 'Putting', name: 'Circle Drill', duration: 15, description: 'Place 8 balls in circle 3 feet from hole, make all 8' },
  { id: 'pt_13', category: 'Putting', name: 'One Hand Drill', duration: 10, description: 'Putt with lead hand only to improve feel' },
  { id: 'pt_14', category: 'Putting', name: 'Clock Drill', duration: 20, description: 'Putt from 4 directions at 3, 6, and 9 feet' },

  // Driver
  { id: 'dr_1', category: 'Driver', name: 'Tempo Swings', duration: 10, description: '70-80% speed only' },
  { id: 'dr_2', category: 'Driver', name: 'Fairway Finder Drill', duration: 15, description: 'Pick narrow target, simulate fairway width' },
  { id: 'dr_3', category: 'Driver', name: 'Shot Shape Practice', duration: 15, description: '5 fades then 5 draws, repeat' },
  { id: 'dr_4', category: 'Driver', name: 'Driver + Wedge Combo', duration: 20, description: 'Driver swing then immediately hit wedge target' },
  { id: 'dr_5', category: 'Driver', name: 'Tee Height Experiment', duration: 15, description: 'Test low/medium/high tee positions' },
  { id: 'dr_6', category: 'Driver', name: 'Pressure Set', duration: 15, description: '10 drives must hit 7 fairways' },
  { id: 'dr_7', category: 'Driver', name: 'Fairway Combine', duration: 20, description: '10 drives, define fairway width. Goal: 7/10' },
  { id: 'dr_8', category: 'Driver', name: 'Pressure Tee Shots', duration: 20, description: 'Visualize real holes, full pre-shot routine every shot' },
  { id: 'dr_9', category: 'Driver', name: 'Driver then Wedge Scoring', duration: 15, description: 'Hit drive then immediately hit wedge inside 20 ft' },
  { id: 'dr_10', category: 'Driver', name: 'Final Pressure', duration: 10, description: 'Must hit 3 fairways in a row to finish' },

  // Wedges
  { id: 'wd_1', category: 'Wedges', name: 'Clock System Wedges', duration: 15, description: '7:30, 9:00, 10:30 swing lengths' },
  { id: 'wd_2', category: 'Wedges', name: 'Distance Combine', duration: 20, description: 'Random yardages called out 50-120 yards' },
  { id: 'wd_3', category: 'Wedges', name: 'Spin Control Drill', duration: 15, description: 'Same distance, different trajectories' },
  { id: 'wd_4', category: 'Wedges', name: 'Tight Lie Practice', duration: 15, description: 'Clean contact focus on tight lies' },
  { id: 'wd_5', category: 'Wedges', name: 'One-Bounce Stop Challenge', duration: 15, description: 'Land ball just onto green edge' },
  { id: 'wd_6', category: 'Wedges', name: 'Competitive Finish', duration: 10, description: 'Closest-to-hole contest vs yourself' },
  { id: 'wd_7', category: 'Wedges', name: 'Wedge Calibration', duration: 15, description: 'Dial in 50, 75, 100 yards precisely' },
  { id: 'wd_8', category: 'Wedges', name: 'Distance Randomness', duration: 20, description: 'Random yardages called out, commit and execute' },
  { id: 'wd_9', category: 'Wedges', name: 'Flight Control', duration: 15, description: 'Same yardage: low, mid, high trajectories' },
  { id: 'wd_10', category: 'Wedges', name: 'Scoring Zone Challenge', duration: 15, description: '10 balls: inside 15ft=2pts, inside 25ft=1pt. Goal: 12+' },
  { id: 'wd_11', category: 'Wedges', name: 'Pressure Finish', duration: 10, description: '3 balls inside 15 ft in a row' },
  { id: 'wd_12', category: 'Wedges', name: 'Distance Control', duration: 20, description: 'Hit pitches to 20, 40, 60, 80 yard targets' },
  { id: 'wd_13', category: 'Wedges', name: 'Trajectory Drill', duration: 15, description: 'Hit high, medium, low pitches to same target' },

  // Bunker
  { id: 'bk_1', category: 'Bunker', name: 'Line Drill', duration: 15, description: 'Draw a line in sand, practice hitting behind it consistently' },
  { id: 'bk_2', category: 'Bunker', name: 'Distance Control', duration: 20, description: 'Hit bunker shots to 10, 20, 30 yard targets' },
  { id: 'bk_3', category: 'Bunker', name: 'Buried Lie Practice', duration: 15, description: 'Practice different lie situations in bunker' },

  // Tournament Simulation
  { id: 'ts_1', category: 'Tournament Simulation', name: 'Full Warm-Up Routine', duration: 10, description: 'Exactly like tournament day warm-up' },
  { id: 'ts_2', category: 'Tournament Simulation', name: 'Random Bag Practice', duration: 20, description: 'Never hit same club twice, full routine every shot' },
  { id: 'ts_3', category: 'Tournament Simulation', name: 'Pre-Shot Routine Reps', duration: 15, description: 'Step away and reset between every shot' },
  { id: 'ts_4', category: 'Tournament Simulation', name: 'Pressure Wedges', duration: 15, description: 'Must finish inside 15-20 ft' },
  { id: 'ts_5', category: 'Tournament Simulation', name: 'Putting Ladder', duration: 15, description: '10, 20, 30, 40 ft no repeats' },
  { id: 'ts_6', category: 'Tournament Simulation', name: 'Last 10 Balls Matter', duration: 15, description: 'Score yourself like tournament swings' },
  { id: 'ts_7', category: 'Tournament Simulation', name: '18-Shot Simulation', duration: 30, description: 'Each shot=new hole, different club+target, track fairway+green+miss quality' },
  { id: 'ts_8', category: 'Tournament Simulation', name: 'Trouble Shot Practice', duration: 15, description: 'Punch shots, low shots, recovery shots' },
  { id: 'ts_9', category: 'Tournament Simulation', name: 'Last 5 Balls Matter', duration: 10, description: 'Score like tournament pressure swings' },

  // Mental Game
  { id: 'mg_1', category: 'Mental Game', name: 'Pre-Shot Routine', duration: 15, description: 'Practice full routine on every shot at the range' },
  { id: 'mg_2', category: 'Mental Game', name: 'Pressure Putting', duration: 15, description: 'Must make 10 in a row from 4 feet or start over' },
  { id: 'mg_3', category: 'Mental Game', name: 'Course Simulation', duration: 30, description: 'Pick 9 holes from a real course and simulate on range' },
  { id: 'mg_4', category: 'Mental Game', name: 'Visualization', duration: 10, description: 'Sit quietly and visualize 9 holes with positive outcomes' },
];

// Standard Plans — 5 days, 60-90 min/day
export const STANDARD_PLANS = [
  ['bs_1', 'bs_2', 'sg_1', 'sg_2', 'pt_1', 'pt_2'],       // Day 1 ~80 min
  ['dr_1', 'dr_2', 'wd_1', 'wd_7', 'pt_4', 'pt_6'],       // Day 2 ~85 min
  ['sg_3', 'sg_4', 'sg_7', 'pt_3', 'pt_5', 'mg_4'],       // Day 3 ~80 min
  ['bs_3', 'bs_4', 'wd_3', 'wd_9', 'pt_8', 'mg_1'],       // Day 4 ~95 min
  ['ts_1', 'ts_3', 'ts_4', 'ts_5', 'bs_6', 'pt_6'],       // Day 5 ~75 min
];

// Elite Plans — 5 days, 120-150 min/day
export const ELITE_PLANS = [
  ['bs_1', 'bs_2', 'bs_3', 'bs_6', 'sg_1', 'sg_2', 'sg_4', 'pt_1', 'pt_2', 'pt_4'],          // Day 1 ~150 min
  ['bs_4', 'bs_5', 'dr_1', 'dr_2', 'dr_4', 'wd_1', 'wd_2', 'pt_5', 'pt_6'],                  // Day 2 ~145 min
  ['bs_7', 'sg_3', 'sg_7', 'sg_8', 'pt_3', 'pt_7', 'pt_9', 'mg_1', 'mg_4'],                  // Day 3 ~145 min
  ['bs_8', 'bs_9', 'dr_6', 'dr_7', 'wd_4', 'wd_10', 'bk_1', 'pt_8', 'pt_10'],               // Day 4 ~150 min
  ['ts_1', 'ts_2', 'ts_3', 'ts_7', 'ts_4', 'ts_5', 'mg_2', 'mg_3'],                          // Day 5 ~150 min
];
