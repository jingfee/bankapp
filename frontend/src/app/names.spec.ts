import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Names, possessive } from './names';

@Component({ template: '' })
class Blank {}

describe('the owner and partner names', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'logga-in', component: Blank },
          { path: '**', component: Blank },
        ]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('are Jag and Partner until the server has said otherwise', () => {
    expect(TestBed.inject(Names).names()).toEqual({ owner: 'Jag', partner: 'Partner' });
  });

  it('are fetched once in the app, kept on the device and forgotten on logout', async () => {
    const names = TestBed.inject(Names);
    names.watch();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    http.expectOne('/api/names').flush({ owner: 'Kim', partner: 'Robin' });
    await router.navigateByUrl('/delat');
    http.expectNone('/api/names');
    expect(names.names()).toEqual({ owner: 'Kim', partner: 'Robin' });

    expect(JSON.parse(localStorage.getItem('bankapp:names') ?? 'null')).toEqual({
      owner: 'Kim',
      partner: 'Robin',
    });

    names.clear();
    expect(names.names()).toEqual({ owner: 'Jag', partner: 'Partner' });
    expect(localStorage.getItem('bankapp:names')).toBeNull();
  });

  it.each([
    ['Kim', 'owner', 'Kims'],
    ['Lars', 'owner', 'Lars'],
    ['Max', 'partner', 'Max'],
    ['Jag', 'owner', 'Din'],
    ['Partner', 'partner', 'Partnerns'],
  ] as const)('puts %s (%s) in the genitive as %s', (name, who, expected) => {
    const names = { owner: 'Jag', partner: 'Partner', [who]: name };
    expect(possessive(names, who)).toBe(expected);
  });

  it('lower-cases din and partnerns mid-sentence, never a name', () => {
    expect(possessive({ owner: 'Jag', partner: 'Partner' }, 'owner', { midSentence: true })).toBe(
      'din',
    );
    expect(possessive({ owner: 'Kim', partner: 'Robin' }, 'partner', { midSentence: true })).toBe(
      'Robins',
    );
  });
});
