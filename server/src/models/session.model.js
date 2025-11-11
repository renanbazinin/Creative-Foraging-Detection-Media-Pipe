const { Schema, model } = require('mongoose');

const MoveSchema = new Schema(
  {
    timestamp: Number,
    elapsed: Number,
    player: {
      type: String,
      default: 'Unknown'
    },
    holdTime: Number,
    blockId: String,
    position: Schema.Types.Mixed,
    allPositions: Schema.Types.Mixed,
    phase: String,
    type: String,
    subjectId: String,
    sessionGameId: String,
    condition: String,
    date: String,
    unit: Schema.Types.Mixed,
    end_position: Schema.Types.Mixed,
    all_positions: Schema.Types.Mixed,
    grid_end_position: Schema.Types.Mixed,
    grid_all_positions: Schema.Types.Mixed,
    gallery_shape_number: Schema.Types.Mixed,
    gallery: Schema.Types.Mixed,
    gallery_normalized: Schema.Types.Mixed,
    camera_frame: Schema.Types.Mixed,
    metadata: Schema.Types.Mixed
  },
  { _id: true, timestamps: false }
);

const SessionSchema = new Schema(
  {
    sessionGameId: {
      type: String,
      required: true,
      index: true,
      unique: true
    },
    subjectId: {
      type: String,
      required: true
    },
    condition: String,
    date: String,
    timeSeconds: Number,
    colorA: String,  // Player A bracelet color (hex)
    colorB: String,  // Player B bracelet color (hex)
    metadata: Schema.Types.Mixed,
    moves: {
      type: [MoveSchema],
      default: []
    }
  },
  {
    timestamps: true
  }
);

module.exports = model('Session', SessionSchema);

