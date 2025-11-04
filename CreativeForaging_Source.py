#!/usr/bin/env python2
# -*- coding: utf-8 -*-
# The Creative Foraging Game
# @Kristian Tylén
# AU 2018

from psychopy import visual, core, event, gui, data
import pandas as pd
import numpy as np
from psychopy.visual import ShapeStim
from scipy import spatial
from scipy.spatial.distance import cdist
import ppc3
#import pyautogui
import matplotlib.pyplot as plt
import matplotlib.patches as patches

# Create popup information box
popup = gui.Dlg(title = "The Creative Game")
popup.addField("ID: ") # Empty box
popup.addField("Condition: ", choices=["individual", "group" ])
popup.addField("Time (in minutes): ")
popup.show()
if popup.OK: # To retrieve data from popup window
    ID = popup.data
elif popup.Cancel: # To cancel the experiment if popup is closed
    core.quit()


# experiment time in secs
EXP_TIME = int(ID[2])*60

# define window
win = visual.Window(fullscr=True, units = 'height', color = 'black')

#win = visual.Window(fullscr=True, screen=1)

# define mouse
myMouse = event.Mouse()

# set condition (pair or individual)
condition = ID[1]

subject = ID[0] # the participant id
writer = ppc3.csvWriter(subject, 'logfiles', headerTrial=True) 

# screenshot directory
screen_shot_path = 'screenshots/'

# define clock
clock = core.Clock()

# get date for unique logfile id
date = data.getDateStr()  

# gallery
frame = visual.Rect(win, width=0.32, height=0.22, pos = [0, -0.35], fillColor = 'white')
gallery = visual.ImageStim(win, image = 'default.png', pos = [0, -0.35], size = [0.3, 0.2]) 

# initial positions
pos = [[-0.315, 0.0], [-0.245,0.0], [-0.175,0.0], [-0.105,0.0], [-0.035,0.0], [0.035,0.0], [0.105,0.0], [0.175,0.0], [0.245,0.0], [0.315, 0.0]]

units = []
for i in range(10):
    unit = visual.Rect(win, width=0.06, height=0.06, lineColor = None, fillColor = 'green', pos = pos[i])
    units += [{
        'unit': unit,
        'number': i,
        'neighbours': [],
        'can_move': False,
        'pos': pos[i]}]

welcome = '''
Welcome to the creative game!

Your task is to move around blocks to create interesting and beautiful figures.

Everytime you have created a figure you like, tap on the gallery in the upper right corner in order to save your figure to the gallery.

The experiment proceeds through {} minutes.

Tell the experimenter when you are ready for the practice round.
'''.format(EXP_TIME/60)

practice_done = '''
This was the end of the practice round. 

Let the experimenter know when you are ready to begin the actual experiment.'''

bye = '''
The experiment is done. Thank you very much for your participation!'''


################## FUNCTIONS ########################

def msg(txt):
    message = visual.TextStim(win, text = txt, color = 'white', height = 0.02)
    message.draw()
    win.flip()
    event.waitKeys()

def drw_units():
    for u in units:
        u['unit'].draw()
    #gallery.draw()

def drw_gallery():
    frame.draw()
    gallery.draw()

def allowed_pos(target):
    allowed = []
    for u in units:
        if u['number'] != target:
            pos = [
                [round(u['pos'][0] - 0.07,3), round(u['pos'][1],3)], 
                [round(u['pos'][0] + 0.07,3), round(u['pos'][1],3)], 
                [round(u['pos'][0], 3), round(u['pos'][1] - 0.07,3)], 
                [round(u['pos'][0], 3), round(u['pos'][1] + 0.07,3)]] 

            allowed += pos
           
    # remove dublicate positions
    a_set = set(tuple(x) for x in allowed)
    allowed = [ list(x) for x in a_set ]
    
    # sort out existing positions
    existing_pos = [unit['pos'] for unit in units] 
    allowed = [pos for pos in allowed if pos not in existing_pos ]
    
    # remove out extreme regions
    allowed = [pos for pos in allowed if pos[0] < 0.735 and pos[0] > -0.735]
    allowed = [pos for pos in allowed if pos[1] < 0.49 and pos[1] > -0.49]
    
    return allowed

def update_neighbours():
    for u in units:
        neighbours = []
        pos = [
                [round(u['pos'][0] - 0.07,3), round(u['pos'][1],3)], 
                [round(u['pos'][0] + 0.07,3), round(u['pos'][1],3)], 
                [round(u['pos'][0], 3), round(u['pos'][1] - 0.07,3)], 
                [round(u['pos'][0], 3), round(u['pos'][1] + 0.07,3)]] 
        existing_pos = [unit['pos'] for unit in units] 
        for p in pos:
            if p in existing_pos:
                n = [existing_pos[existing_pos.index(p)]]
                neighbours += n
        u['neighbours'] = neighbours
                


def snap_to_allowed(allowed, pos):
    a_pos = allowed[spatial.KDTree(allowed).query(pos)[1]]
    return a_pos

def update_positions():
    position_update = [unit['pos'] for unit in units]
    return position_update

def is_contiguous(grid):
    
    items = {(x, y) for x, row in enumerate(grid) for y, f in enumerate(row) if f}

    directions = [(0, 1), (1, 0), (-1, 0), (0, -1)]
    neighbours = {(x, y): [(x+dx, y+dy) for dx, dy in directions if (x+dx, y+dy) in items]
                  for x, y in items}

    closed = set()
    fringe = [next(iter(items))]
    while fringe:
        i = fringe.pop()
        if i in closed:
            continue
        closed.add(i)
        for n in neighbours[i]:
            fringe.append(n)

    return items == closed

def prepare_matrix(pos, t):
    x = pd.DataFrame(pos)#.sort_values(by=0)
    
    x = np.arange(-0.945, 1.015, 0.07)
    y = np.append(np.arange(-0.7, 0, 0.07), np.arange(0, 0.77, 0.07))
    x = np.around(x, 3)
    y = np.around(y, 3)
    
    grid = np.zeros(shape=(len(y),len(x)))
    
    for i in pos:
        
        grid[y.tolist().index(i[1]), x.tolist().index(i[0])] = i[0]
    
    grid[y.tolist().index(pos[t][1]), x.tolist().index(pos[t][0])] = 0.0
    
    
    grid = grid.tolist()
    
    return is_contiguous(grid)

def can_move(pos,phase):
    
    for j in range(len(pos)):
        if prepare_matrix(pos[:],j):
            units[j]['can_move'] = True
            if phase == 'practice':
                units[j]['unit'].fillColor = 'blue'
        elif not prepare_matrix(pos[:],j):
            units[j]['can_move'] = False
            if phase == 'practice':
                units[j]['unit'].fillColor = 'green'
        if phase == 'experiment': 
            units[j]['unit'].fillColor = 'green'
        
def closest_node(node, nodes):
    return nodes[cdist([node], nodes).argmin()]

def reset_positions(figure):
    try:
        # calculate centroid
        x,y=zip(*figure)
        centroid=(max(x)+min(x))/2., (max(y)+min(y))/2.
        # find the node closest to the centroid
        c_node = closest_node(centroid, figure)
    
        # calculate the difference between centroid and center node 
        c_node_dif = [p*-1 for p in c_node]
        
        # move all node coordinates by the distance
        fig_update = [list(np.array(f) + np.array(c_node_dif)) for f in figure]
        fig_update = [[round(f[0],3) , round(f[1],3)] for f in fig_update]
        fig_update.sort()
    except:
        fig_update = np.nan
        
    return fig_update

def draw_and_save_squares_zoomed_centered_fixed_canvas(
    coords, square_size=0.07, canvas_size=10, margin=0.2, output_file='output.png'):
    """
    Draws green squares centered and zoomed within a fixed-size canvas, then saves it.
    
    Args:
        coords (list of tuples): List of (x, y) centered around (0, 0).
        square_size (float): Width/height of each square.
        canvas_size (float): Fixed size of canvas (both width and height).
        margin (float): Padding around squares to avoid edge clipping (in canvas units).
        output_file (str): Filename for saving the image.
    """
    fig, ax = plt.subplots(figsize=(5, 5), dpi=100)
    fig.patch.set_facecolor('black')
    ax.set_facecolor('black')

    # Shift coordinates to [0, 1] range
    shifted_coords = [(x + 0.5, y + 0.5) for x, y in coords]

    # Compute bounding box of shifted squares
    xs, ys = zip(*shifted_coords)
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    # Compute center of squares
    center_x = (min_x + max_x + square_size) / 2
    center_y = (min_y + max_y + square_size) / 2

    # Scale shifted coordinates to canvas units centered at (canvas_size/2, canvas_size/2)
    final_coords = [
        (
            (x - center_x) * canvas_size + (canvas_size / 2),
            (y - center_y) * canvas_size + (canvas_size / 2)
        )
        for x, y in shifted_coords
    ]

    # Set fixed canvas limits with margin
    ax.set_xlim(0, canvas_size)
    ax.set_ylim(0, canvas_size)
    ax.set_aspect('equal')

    # Draw the squares
    for (x, y) in final_coords:
        square = patches.Rectangle(
            (x, y), square_size * canvas_size, square_size * canvas_size,
            linewidth=1,
            edgecolor='black',
            facecolor='green'
        )
        ax.add_patch(square)

    plt.axis('off')
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    plt.savefig(output_file, dpi=300, bbox_inches='tight', pad_inches=0, facecolor='black')
    plt.close()
    
def save_to_gallery(positions, subject, gallery_number, date):
    
    pos_norm = reset_positions(positions)
    
    trial = {
        'date': date,
        'id': subject,
        'condition': condition,
        'phase': phase,
        'type': 'added shape to gallery',
        'time': clock.getTime(),
        'unit': np.nan,
        'end_position': np.nan,
        'all_positions': np.nan,
        'gallery_shape_number': gallery_number,
        'gallery': positions,
        'gallery_normalized': pos_norm
        }
    writer.write(trial)
    filename = 'gallery_{}_{}_{}.png'.format(subject, gallery_number, date)
    drw_units()
    win.flip()
    
    draw_and_save_squares_zoomed_centered_fixed_canvas(positions, output_file = screen_shot_path + filename)
    
    #time.sleep(0.2)  # תן למסך להתעדכן
    #screenshot = pyautogui.screenshot()
    #screenshot.save(screen_shot_path + filename)

    #win.getMovieFrame()
    #win.saveMovieFrames(screen_shot_path + filename)
    
    gallery.image = (screen_shot_path + filename)

    
gallery_number = 0
release = False
endTrial = False
phase = 'practice'

msg(welcome)

while not endTrial:
    
    # get key for gallery save
    key = event.getKeys()
    
    if clock.getTime() > EXP_TIME or key == ['q']:
        endTrial = True
    elif key == ['p']:
        msg(practice_done)
        phase = 'experiment'
        clock.reset()
        for i in range(10):
            units[i]['unit'].setPos(pos[i])
        gallery.image = 'default.png'
        drw_units()
        drw_gallery()
        win.flip()
            
    
    
    mouse_down_detected = False
    
    # get mouse button presses
    mouse1, mouse2, mouse3 = myMouse.getPressed()
    
    # update neighbours
    update_neighbours()
    
    # update which units can move
    positions = update_positions()
    can_move(positions, phase)
    
    # check if object is clicked
    for unit in units:
        unit['pos'] = [round(unit['unit'].pos[0], 3), round(unit['unit'].pos[1], 3)]
        
        while mouse1 and myMouse.isPressedIn(unit['unit']) and unit['can_move']:
            target = unit
            target['unit'].setPos(myMouse.getPos())
            drw_units()
            drw_gallery()
            win.flip()
            release = True
            
        if release:
            release = False
            al_pos = allowed_pos(target['number'])
            snap = snap_to_allowed(al_pos, target['unit'].pos)
            target['unit'].setPos(snap)
            target['pos'] = snap
            
            trial = {
            'date': date,
            'id': subject,
            'condition': condition,
            'phase': phase,
            'type': 'moveblock',
            'time': clock.getTime(),
            'unit': target['number'],
            'end_position': snap,
            'all_positions': positions,
            'gallery_shape_number': np.nan,
            'gallery': np.nan,
            'gallery_normalized': np.nan
            }
            writer.write(trial)
            
            positions = update_positions()
            can_move(positions,phase)
            
        drw_units()
        
        
    if myMouse.isPressedIn(gallery):
        myMouse.clickReset()
        if not mouse_down_detected:
            gallery_number += 1
            save_to_gallery(positions, subject, gallery_number, date)
            drw_units()
            drw_gallery()
            win.flip()
            mouse_down_detected = True
            core.wait(0.2)
    drw_gallery()
    win.flip()
msg(bye)