# -*- coding: utf-8 -*-
"""
Useful complements to psychopy.
Jonas Lindeløv, 2014
"""

class sound(object):
    """
    A windows-only low-latency replacement for psychopy.sound.
    It can only play wav files. Timing is unreliable if sound.play() is called before previous sound ends. Usage::
        beep = sound('beep.wav')
        beep.play()
    """
    def __init__(self, filename):
        """ :filename: a .wav file"""
        self.filename = filename
        self.winsound = __import__('winsound')
    def play(self):
        """ plays the sound file with low latency"""
        self.winsound.PlaySound(self.filename,  self.winsound.SND_FILENAME | self.winsound.SND_ASYNC)


def timer(script, setup='', timeScale=-3, runs=10 ** 3):
    """
    Times code snippets and returns average duration in seconds.

    :script: a string to be timed
    :setup: a comma-separated string specifying methods and variables to be imported from __main__
    :timeScale: the unit for seconds. -9 = 10^-9 = nanoseconds
    :runs: how many times to run the script.
    """
    if setup:
        setup = 'from __main__ import ' + setup

    import timeit
    timeit.timeit(number=10**7)  # get the computer's attention. First run is slower.
    baseline = timeit.timeit(setup=setup, number=runs)  # the time it takes to run an empty script
    result = timeit.timeit(script, setup=setup, number=runs) - baseline  # Run the test!

    print('\n\'', script, '\'')
    print('RESULT:', round(result / runs / 10**timeScale, 3), end=' ')
    print('ns' if timeScale == -9 else 'microseconds' if timeScale == -6 else 'ms' if timeScale == -3 else 's' if timeScale in (0, 1) else ' *10^'+str(timeScale)+' s')
    return result - baseline


def deg2cm(angle, distance):
    """
    Returns the size of a stimulus in cm given:
        :distance: ... to monitor in cm
        :angle: ... that stimulus extends as seen from the eye

    Use this function to verify whether your stimuli are the expected size.
    (there's an equivalent in from psychopy.tools.monitorunittools.deg2cm)
    """
    import math
    return math.tan(math.radians(angle)) * distance  # trigonometry


class csvWriter(object):
    def __init__(self, saveFilePrefix='', saveFolder='', headerTrial=False):
        """
        Creates a csv file and appends single rows to it using the csvWriter.write() function.
        Use this function to save trials. Writing is very fast. Around a microsecond.

        :saveFilePrefix: a string to prefix the file with
        :saveFolder: (string/False) if False, uses same directory as the py file
        :headerTrial: (dict/False) writes dict.keys() as header row in csv.
        """
        import csv, time

        # Create folder if it doesn't exist
        if saveFolder:
            import os
            saveFolder += '/'
            if not os.path.isdir(saveFolder):
                os.makedirs(saveFolder)

        # Generate self.saveFile and self.writer
        self.saveFile = saveFolder + str(saveFilePrefix) + ' (' + time.strftime('%Y-%m-%d %H-%M-%S', time.localtime()) +').csv'  # Filename for csv. E.g. "myFolder/subj1_cond2 (2013-12-28 09-53-04).csv"
        self.writer = csv.writer(open(self.saveFile, 'w'), delimiter=';').writerow  # The writer function to csv. Appends a single row to file
        #self.writer = csv.writer(open(self.saveFile, 'wb'), delimiter=';').writerow  # The writer function to csv. Appends a single row to file
        
        self.headerWritten = False

    def write(self, trial):
        """:trial: a dictionary"""
        if not self.headerWritten:
            self.headerWritten = True
            self.writer(trial.keys())
        self.writer(trial.values())
        
        
        
        #if headerTrial:
        #    self.writer(list(headerTrial.keys()))

#    def write(self, trial):
#        """:trial: a dictionary"""
#        self.writer(list(trial.values()))
#    
#    """ A function added by MW in order to be able to write headers to the logfile"""
#    def writeheader(self,trial):
#        """:trial: a dictionary"""
#        self.writer(list(trial.keys()))
        
def getActualFrameRate(frames=1000):
    """
    Measures the actual framerate of your monitor. It's not always as clean as
    you'd think. Prints various useful information.
        :frames: number of frames to do test on.
    """
    from psychopy import visual, core

    # Set stimuli up
    durations = []
    clock = core.Clock()
    win = visual.Window()
    win.flip()  # to synchronize to vertical blanks
    clock.reset()

    # Run the test!
    for i in range(frames):
        win.flip()
        durations += [clock.getTime()]
        clock.reset()

    win.close()

    # Print summary
    import numpy as np
    print('average frame duration was', round(np.average(durations) * 1000, 3), 'ms (SD', round(np.std(durations), 5), ') ms')
    print('corresponding to a framerate of', round(1 / np.average(durations), 3), 'Hz')
    print('60 frames on your monitor takes', round(np.average(durations) * 60 * 1000, 3), 'ms')
    print('shortest duration was ', round(min(durations) * 1000, 3), 'ms and longest duration was ', round(max(durations) * 1000, 3), 'ms')

def dkl2rgb(dkl):
    """ takes a DKL color as input and returns the corresponding RGB color """
    from numpy import array
    from psychopy.misc import dkl2rgb
    return dkl2rgb(array(dkl))